# One2many Search

One2many Search adds a native-looking search bar above configured One2many lists in Odoo 19.

Users type a value and select a suggested field before the search runs. The current list then displays only matching lines without changing, deleting, or reordering the underlying relation.

## Features

- Configure search independently for any supported One2many field.
- Search a selected field or all configured fields.
- Suggest searchable fields from visible list columns.
- Use case-insensitive partial matching for text-like fields.
- Use exact matching for integer, float, and monetary fields.
- Include stored, new, and edited lines in the displayed results.
- Respect the current user's access rights, field groups, and record rules.

## Configuration

1. Install **One2many Search**.
2. Enable developer mode.
3. Open **Settings → Technical → Database Structure → One2many Search**.
4. Create a configuration.
5. Select the parent model and its One2many field.
6. Select the searchable stored fields on the line model, or use **Use Visible List Columns**.
7. Save the configuration and refresh the target form.

## Usage

1. Enter a value in the search bar above the configured One2many list.
2. Select a field suggestion or **all configured fields**.
3. Review the matching lines.
4. Clear the search to restore the complete list.

## Compatibility

- Odoo 19.0
- Community and Enterprise installations that support custom addons

## License

LGPL-3
