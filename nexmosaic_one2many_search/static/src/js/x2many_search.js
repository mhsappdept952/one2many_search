/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { X2ManyField } from "@web/views/fields/x2many/x2many_field";
import { onWillDestroy, onWillStart, useState } from "@odoo/owl";

function valueMatches(value, term) {
    if (value === false || value === null || value === undefined) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some((item) => valueMatches(item, term));
    }
    if (typeof value === "object") {
        return valueMatches(value.display_name || value.name || "", term);
    }
    return String(value).toLocaleLowerCase().includes(term);
}

patch(X2ManyField.prototype, {
    setup() {
        super.setup(...arguments);
        this.orm = useService("orm");
        this.searchState = useState({
            enabled: false,
            fields: [],
            placeholder: "",
            term: "",
            matchingIds: null,
            loading: false,
            selectedFieldName: false,
            selectedFieldLabel: "",
            selectedTerm: "",
            showSuggestions: false,
            highlightedSuggestion: -1,
        });
        this._searchTimer = null;
        this._searchRequest = 0;

        onWillStart(async () => {
            if (this.isMany2Many || this.props.viewMode !== "list") {
                return;
            }
            const configuration = await this.orm.call(
                "one2many.search.configuration",
                "get_field_search_configuration",
                [this.props.record.resModel, this.props.name]
            );
            if (configuration) {
                Object.assign(this.searchState, {
                    enabled: true,
                    fields: configuration.fields,
                    placeholder: configuration.placeholder,
                });
            }
        });
        onWillDestroy(() => clearTimeout(this._searchTimer));
    },

    get hasActiveSearch() {
        return Boolean(this.searchState.enabled && this.searchState.matchingIds !== null);
    },

    get showO2mSearchSuggestions() {
        return Boolean(
            this.searchState.showSuggestions && this.searchState.term.trim() && this.searchState.fields.length
        );
    },

    get o2mSearchSuggestions() {
        return [
            { name: false, label: "all configured fields" },
            ...this.searchState.fields,
        ];
    },

    get searchResultCount() {
        return this.searchState.matchingIds ? this.searchState.matchingIds.length : 0;
    },

    get searchList() {
        if (!this.hasActiveSearch || !this.searchState.matchingIds) {
            return this.list;
        }
        const matchingIds = new Set(this.searchState.matchingIds);
        const records = this.list.currentIds
            .filter((id) => matchingIds.has(id))
            .map((id) => this.list._cache[id])
            .filter(Boolean);
        const overrides = {
            records,
            count: records.length,
            limit: records.length,
            offset: 0,
        };
        return new Proxy(this.list, {
            get(target, property) {
                if (property in overrides) {
                    return overrides[property];
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    },

    get rendererProps() {
        const props = super.rendererProps;
        if (this.hasActiveSearch && this.searchState.matchingIds) {
            props.list = this.searchList;
        }
        return props;
    },

    onO2mSearchInput(event) {
        this.searchState.term = event.target.value;
        this.searchState.selectedFieldName = false;
        this.searchState.selectedFieldLabel = "";
        this.searchState.selectedTerm = "";
        this.searchState.showSuggestions = true;
        this.searchState.highlightedSuggestion = -1;
        this.searchState.matchingIds = null;
        this.searchState.loading = false;
        this._searchRequest++;
        clearTimeout(this._searchTimer);
        if (!this.searchState.term.trim()) {
            this.searchState.showSuggestions = false;
            return;
        }
    },

    onO2mSearchKeydown(event) {
        if (!this.showO2mSearchSuggestions) {
            return;
        }
        const suggestions = this.o2mSearchSuggestions;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (event.key === "ArrowDown") {
                this.searchState.highlightedSuggestion =
                    (this.searchState.highlightedSuggestion + 1) % suggestions.length;
            } else {
                this.searchState.highlightedSuggestion =
                    this.searchState.highlightedSuggestion <= 0
                        ? suggestions.length - 1
                        : this.searchState.highlightedSuggestion - 1;
            }
        } else if (event.key === "Enter") {
            event.preventDefault();
            const suggestion = suggestions[this.searchState.highlightedSuggestion];
            if (suggestion) {
                this.selectO2mSearchField(suggestion.name, suggestion.label);
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            this.searchState.showSuggestions = false;
        }
    },

    selectO2mSearchField(fieldName, fieldLabel) {
        const term = this.searchState.term.trim();
        this.searchState.selectedFieldName = fieldName;
        this.searchState.selectedFieldLabel = fieldLabel;
        this.searchState.selectedTerm = term;
        this.searchState.term = "";
        this.searchState.showSuggestions = false;
        clearTimeout(this._searchTimer);
        if (term) {
            this.searchState.loading = true;
            this.searchState.matchingIds = [];
            this._runO2mSearch(term);
        }
    },

    selectAllO2mSearchFields() {
        this.selectO2mSearchField(false, "all configured fields");
    },

    clearO2mSearch() {
        clearTimeout(this._searchTimer);
        this._searchRequest++;
        this.searchState.term = "";
        this.searchState.matchingIds = null;
        this.searchState.loading = false;
        this.searchState.selectedFieldName = false;
        this.searchState.selectedFieldLabel = "";
        this.searchState.selectedTerm = "";
        this.searchState.showSuggestions = false;
    },

    async _runO2mSearch(term) {
        const request = ++this._searchRequest;
        const lineIds = this.list.currentIds.filter((id) => typeof id === "number");
        const fieldNames = this.searchState.selectedFieldName
            ? [this.searchState.selectedFieldName]
            : this.searchState.fields.map((field) => field.name);
        try {
            const matchingStoredIds = new Set(
                await this.orm.call("one2many.search.configuration", "search_line_ids", [
                    this.props.record.resModel,
                    this.props.name,
                    lineIds,
                    term,
                    fieldNames,
                ])
            );
            if (request !== this._searchRequest) {
                return;
            }
            await this._loadMatchingRecords(matchingStoredIds);
            const normalizedTerm = term.toLocaleLowerCase();
            const matchingIds = this.list.currentIds.filter((id) => {
                const record = this.list._cache[id];
                if (!record || (!record.isNew && !record.dirty)) {
                    return matchingStoredIds.has(id);
                }
                return fieldNames.some((fieldName) =>
                    valueMatches(record.data[fieldName], normalizedTerm)
                );
            });
            if (request === this._searchRequest) {
                this.searchState.matchingIds = matchingIds;
            }
        } finally {
            if (request === this._searchRequest) {
                this.searchState.loading = false;
            }
        }
    },

    async _loadMatchingRecords(matchingStoredIds) {
        const recordsToLoad = [...matchingStoredIds].filter((id) => !this.list._cache[id]);
        if (!recordsToLoad.length) {
            return;
        }
        const values = await this.list.model._loadRecords(
            { ...this.list.config, resIds: recordsToLoad },
            this.list.evalContext
        );
        for (const value of values) {
            this.list._createRecordDatapoint(value);
        }
    },
});
