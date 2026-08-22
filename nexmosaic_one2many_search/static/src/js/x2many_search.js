odoo.define("nexmosaic_one2many_search.x2many_search", function (require) {
    "use strict";

    const core = require("web.core");
    const relationalFields = require("web.relational_fields");

    const FieldOne2Many = relationalFields.FieldOne2Many;
    const qweb = core.qweb;

    function valueMatches(value, term) {
        if (value === false || value === null || value === undefined) {
            return false;
        }
        if (Array.isArray(value)) {
            return value.some((item) => valueMatches(item, term));
        }
        if (typeof value === "object") {
            return valueMatches(value.display_name || value.name || value.data || "", term);
        }
        return String(value).toLocaleLowerCase().includes(term);
    }

    FieldOne2Many.include({
        init: function () {
            this._super.apply(this, arguments);
            this._o2mSearchState = {
                enabled: false,
                fields: [],
                placeholder: "",
                term: "",
                matchingDataPointIds: null,
                loading: false,
                selectedFieldName: false,
                selectedFieldLabel: "",
                selectedTerm: "",
                showSuggestions: false,
                highlightedSuggestion: -1,
            };
            this._o2mSearchRequest = 0;
        },

        willStart: function () {
            const parent = this._super.apply(this, arguments);
            if (!this.view || this.view.arch.tag !== "tree") {
                return parent;
            }
            const configuration = this._rpc({
                model: "one2many.search.configuration",
                method: "get_field_search_configuration",
                args: [this.record.model, this.name],
            }).then((result) => {
                if (result) {
                    Object.assign(this._o2mSearchState, {
                        enabled: true,
                        fields: result.fields,
                        placeholder: result.placeholder,
                    });
                }
            });
            return Promise.all([parent, configuration]);
        },

        _render: function () {
            const rendered = this._super.apply(this, arguments);
            return Promise.resolve(rendered).then(() => {
                this._renderO2mSearch();
                this._applyO2mSearchFilter();
            });
        },

        _o2mSearchSuggestions: function () {
            return [{ name: false, label: "all configured fields" }].concat(
                this._o2mSearchState.fields
            );
        },

        _renderO2mSearch: function () {
            this.$(".o_o2m_search").remove();
            if (!this._o2mSearchState.enabled || !this.view || this.view.arch.tag !== "tree") {
                return;
            }
            const $search = $(
                qweb.render("nexmosaic_one2many_search.LegacyX2ManySearch", {
                    widget: this,
                })
            );
            const $controlPanel = this.$(".o_x2m_control_panel").first();
            if ($controlPanel.length) {
                $controlPanel.after($search);
            } else {
                this.$el.prepend($search);
            }
            $search.on("input", ".o_o2m_search_input", this._onO2mSearchInput.bind(this));
            $search.on("keydown", ".o_o2m_search_input", this._onO2mSearchKeydown.bind(this));
            $search.on(
                "mousedown",
                ".o_o2m_search_suggestion",
                this._onO2mSearchSuggestion.bind(this)
            );
            $search.on("click", ".o_o2m_search_clear", this._clearO2mSearch.bind(this));
        },

        _onO2mSearchInput: function (event) {
            const state = this._o2mSearchState;
            state.term = event.target.value;
            state.selectedFieldName = false;
            state.selectedFieldLabel = "";
            state.selectedTerm = "";
            state.showSuggestions = Boolean(state.term.trim());
            state.highlightedSuggestion = -1;
            state.matchingDataPointIds = null;
            state.loading = false;
            this._o2mSearchRequest += 1;
            this._renderO2mSearch();
            this._applyO2mSearchFilter();
            if (state.showSuggestions) {
                this.$(".o_o2m_search_input").focus();
                const input = this.$(".o_o2m_search_input").get(0);
                input.setSelectionRange(input.value.length, input.value.length);
            }
        },

        _onO2mSearchKeydown: function (event) {
            const state = this._o2mSearchState;
            if (!state.showSuggestions) {
                return;
            }
            const suggestions = this._o2mSearchSuggestions();
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (event.key === "ArrowDown") {
                    state.highlightedSuggestion =
                        (state.highlightedSuggestion + 1) % suggestions.length;
                } else {
                    state.highlightedSuggestion =
                        state.highlightedSuggestion <= 0
                            ? suggestions.length - 1
                            : state.highlightedSuggestion - 1;
                }
                this.$(".o_o2m_search_suggestion").removeClass("active");
                this.$(".o_o2m_search_suggestion")
                    .eq(state.highlightedSuggestion)
                    .addClass("active");
            } else if (event.key === "Enter") {
                event.preventDefault();
                const suggestion = suggestions[state.highlightedSuggestion];
                if (suggestion) {
                    this._selectO2mSearchField(suggestion.name, suggestion.label);
                }
            } else if (event.key === "Escape") {
                event.preventDefault();
                state.showSuggestions = false;
                this.$(".o_o2m_search_suggestions").removeClass("show");
            }
        },

        _onO2mSearchSuggestion: function (event) {
            event.preventDefault();
            const $target = $(event.currentTarget);
            this._selectO2mSearchField(
                $target.attr("data-field") || false,
                $target.attr("data-label")
            );
        },

        _selectO2mSearchField: function (fieldName, fieldLabel) {
            const state = this._o2mSearchState;
            const term = state.term.trim();
            state.selectedFieldName = fieldName;
            state.selectedFieldLabel = fieldLabel;
            state.selectedTerm = term;
            state.term = "";
            state.showSuggestions = false;
            if (!term) {
                return;
            }
            state.loading = true;
            state.matchingDataPointIds = new Set();
            this._renderO2mSearch();
            this._runO2mSearch(term);
        },

        _clearO2mSearch: function (event) {
            if (event) {
                event.preventDefault();
            }
            this._o2mSearchRequest += 1;
            Object.assign(this._o2mSearchState, {
                term: "",
                matchingDataPointIds: null,
                loading: false,
                selectedFieldName: false,
                selectedFieldLabel: "",
                selectedTerm: "",
                showSuggestions: false,
                highlightedSuggestion: -1,
            });
            this._renderO2mSearch();
            this._applyO2mSearchFilter();
        },

        _runO2mSearch: async function (term) {
            const request = ++this._o2mSearchRequest;
            const state = this._o2mSearchState;
            const records = (this.value && this.value.data) || [];
            const lineIds = ((this.value && this.value.res_ids) || []).filter(
                (id) => typeof id === "number"
            );
            const fieldNames = state.selectedFieldName
                ? [state.selectedFieldName]
                : state.fields.map((field) => field.name);
            try {
                const storedIds = new Set(
                    await this._rpc({
                        model: "one2many.search.configuration",
                        method: "search_line_ids",
                        args: [this.record.model, this.name, lineIds, term, fieldNames],
                    })
                );
                if (request !== this._o2mSearchRequest) {
                    return;
                }
                const normalizedTerm = term.toLocaleLowerCase();
                const matchingDataPointIds = new Set();
                records.forEach((record) => {
                    const localMatch = fieldNames.some((fieldName) =>
                        valueMatches(record.data[fieldName], normalizedTerm)
                    );
                    if ((record.res_id && storedIds.has(record.res_id)) || localMatch) {
                        matchingDataPointIds.add(String(record.id));
                    }
                });
                state.matchingDataPointIds = matchingDataPointIds;
            } finally {
                if (request === this._o2mSearchRequest) {
                    state.loading = false;
                    this._renderO2mSearch();
                    this._applyO2mSearchFilter();
                }
            }
        },

        _applyO2mSearchFilter: function () {
            const matchingIds = this._o2mSearchState.matchingDataPointIds;
            this.$("tr.o_data_row").each(function () {
                const $row = $(this);
                $row.toggle(
                    matchingIds === null || matchingIds.has(String($row.attr("data-id")))
                );
            });
        },
    });
});
