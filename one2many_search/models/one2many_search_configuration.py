from decimal import Decimal, InvalidOperation

from lxml import etree

from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError


SEARCHABLE_TYPES = {
    "char",
    "date",
    "datetime",
    "float",
    "html",
    "integer",
    "many2one",
    "monetary",
    "reference",
    "selection",
    "text",
}
NUMERIC_SEARCHABLE_TYPES = {"float", "integer", "monetary"}


class One2manySearchConfiguration(models.Model):
    _name = "one2many.search.configuration"
    _description = "One2many Search Configuration"
    _order = "model_id, field_id"
    _rec_name = "name"

    name = fields.Char(compute="_compute_name", store=True, readonly=True)
    active = fields.Boolean(default=True)
    model_id = fields.Many2one(
        "ir.model",
        string="Parent Model",
        required=True,
        ondelete="cascade",
        index=True,
    )
    field_id = fields.Many2one(
        "ir.model.fields",
        string="One2many Field",
        required=True,
        ondelete="cascade",
        index=True,
    )
    line_model_id = fields.Many2one(
        "ir.model",
        string="Line Model",
        compute="_compute_line_model_id",
        store=True,
        readonly=True,
    )
    searchable_field_ids = fields.Many2many(
        "ir.model.fields",
        "one2many_search_configuration_field_rel",
        "configuration_id",
        "field_id",
        string="Searchable Fields",
        help="The direct fields on the line model that are searched. Only fields the current user can access are used.",
    )

    _one_configuration_per_field = models.Constraint(
        "UNIQUE(model_id, field_id)",
        "Only one search configuration is allowed for each One2many field.",
    )

    @api.depends("model_id", "field_id")
    def _compute_name(self):
        for configuration in self:
            if configuration.model_id and configuration.field_id:
                configuration.name = "%s / %s" % (
                    configuration.model_id.name,
                    configuration.field_id.field_description,
                )
            else:
                configuration.name = False

    @api.depends("field_id", "field_id.relation")
    def _compute_line_model_id(self):
        IrModel = self.env["ir.model"]
        for configuration in self:
            relation = configuration.field_id.relation
            configuration.line_model_id = IrModel._get(relation).id if relation else False

    @api.onchange("model_id")
    def _onchange_model_id(self):
        self.field_id = False
        self.searchable_field_ids = [fields.Command.clear()]

    @api.onchange("field_id")
    def _onchange_field_id(self):
        self.searchable_field_ids = [fields.Command.clear()]

    @api.constrains("model_id", "field_id", "line_model_id", "searchable_field_ids")
    def _check_configuration(self):
        for configuration in self:
            field = configuration.field_id
            if not field:
                continue
            if field.model_id != configuration.model_id or field.ttype != "one2many":
                raise ValidationError(_("The selected field must be a One2many field of the parent model."))
            if not configuration.line_model_id or field.relation != configuration.line_model_id.model:
                raise ValidationError(_("The selected One2many field has an invalid line model."))
            invalid_fields = configuration.searchable_field_ids.filtered(
                lambda searchable: (
                    searchable.model_id != configuration.line_model_id
                    or searchable.ttype not in SEARCHABLE_TYPES
                    or not searchable.store
                )
            )
            if invalid_fields:
                raise ValidationError(
                    _("Searchable fields must be stored, direct fields of the One2many line model.")
                )

    def _get_configuration(self, parent_model, field_name):
        """Return a configuration only when it is safe to expose to this user."""
        if not isinstance(parent_model, str) or not isinstance(field_name, str):
            return self.browse()
        parent_ir_model = self.env["ir.model"]._get(parent_model)
        if not parent_ir_model:
            return self.browse()
        configuration = self.search(
            [
                ("active", "=", True),
                ("model_id", "=", parent_ir_model.id),
                ("field_id.name", "=", field_name),
            ],
            limit=1,
        )
        if not configuration or not self.env[parent_model].check_access_rights("read", raise_exception=False):
            return self.browse()
        return configuration

    def _accessible_searchable_fields(self):
        self.ensure_one()
        user_groups = self.env.user.group_ids
        return self.searchable_field_ids.filtered(
            lambda field: not field.groups or bool(field.groups & user_groups)
        )

    @staticmethod
    def _field_search_domain(field, search_term):
        """Use exact matching for numbers, whose formatted values contain trailing zeroes."""
        if field.ttype not in NUMERIC_SEARCHABLE_TYPES:
            return fields.Domain(field.name, "ilike", search_term)
        try:
            numeric_value = Decimal(search_term)
        except InvalidOperation:
            return fields.Domain.FALSE
        if field.ttype == "integer":
            if numeric_value != numeric_value.to_integral_value():
                return fields.Domain.FALSE
            numeric_value = int(numeric_value)
        else:
            numeric_value = float(numeric_value)
        return fields.Domain(field.name, "=", numeric_value)

    def action_suggest_searchable_fields(self):
        """Select direct line fields visible in the first matching parent form view."""
        self.ensure_one()
        if not self.field_id or not self.line_model_id:
            raise UserError(_("Select a One2many field first."))

        visible_names = []
        parent_views = self.env["ir.ui.view"].search(
            [("model", "=", self.model_id.model), ("type", "=", "form"), ("active", "=", True)],
            order="priority, id",
        )
        for view in parent_views:
            try:
                arch = etree.fromstring(view.arch.encode())
            except (TypeError, etree.XMLSyntaxError):
                continue
            for x2many_node in arch.xpath(".//field[@name=$field_name]", field_name=self.field_id.name):
                list_nodes = x2many_node.xpath("./list | ./tree")
                for list_node in list_nodes:
                    visible_names.extend(list_node.xpath(".//field/@name"))
            if visible_names:
                break

        # A dedicated list view is a useful fallback for models whose parent form embeds no list arch.
        if not visible_names:
            list_view = self.env["ir.ui.view"].search(
                [("model", "=", self.line_model_id.model), ("type", "=", "list"), ("active", "=", True)],
                order="priority, id",
                limit=1,
            )
            if list_view:
                try:
                    arch = etree.fromstring(list_view.arch.encode())
                    visible_names = arch.xpath(".//field/@name")
                except (TypeError, etree.XMLSyntaxError):
                    pass

        suggested_fields = self.env["ir.model.fields"].search(
            [
                ("model_id", "=", self.line_model_id.id),
                ("name", "in", visible_names),
                ("store", "=", True),
            ]
        ).filtered(lambda field: field.ttype in SEARCHABLE_TYPES)
        if not suggested_fields:
            raise UserError(_("No searchable fields were found in a visible list view."))
        self.searchable_field_ids = [fields.Command.set(suggested_fields.ids)]
        return {"type": "ir.actions.client", "tag": "reload"}

    @api.model
    def get_field_search_configuration(self, parent_model, field_name):
        """Called by the web client when it renders an x2many field."""
        configuration = self._get_configuration(parent_model, field_name)
        searchable_fields = configuration._accessible_searchable_fields() if configuration else self.env[
            "ir.model.fields"
        ]
        if not searchable_fields:
            return False
        return {
            "placeholder": _("Search %(field)s...", field=configuration.field_id.field_description),
            "fields": [
                {"name": field.name, "label": field.field_description}
                for field in searchable_fields
            ],
        }

    @api.model
    def search_line_ids(self, parent_model, field_name, line_ids, term, selected_field_names=None):
        """Find matching existing lines without bypassing access rules or record rules."""
        configuration = self._get_configuration(parent_model, field_name)
        searchable_fields = configuration._accessible_searchable_fields() if configuration else self.env[
            "ir.model.fields"
        ]
        if not searchable_fields or not isinstance(term, str):
            return []
        if selected_field_names:
            selected_field_names = set(selected_field_names)
            searchable_fields = searchable_fields.filtered(
                lambda field: field.name in selected_field_names
            )
        if not searchable_fields:
            return []
        line_ids = [line_id for line_id in line_ids if isinstance(line_id, int)]
        if not line_ids:
            return []
        search_term = term.strip()
        if not search_term:
            return line_ids
        field_domain = fields.Domain.OR(
            [self._field_search_domain(field, search_term) for field in searchable_fields]
        )
        return self.env[configuration.line_model_id.model].search(
            fields.Domain("id", "in", line_ids) & field_domain
        ).ids
