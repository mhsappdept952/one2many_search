{
    "name": "One2many Search",
    "summary": "Search configured One2many lines instantly",
    "version": "19.0.1.0.0",
    "category": "Tools",
    "author": "NexMosaic Technologies",
    "license": "LGPL-3",
    "icon": "/one2many_search/static/description/search_icon.svg",
    "depends": ["web"],
    "data": [
        "security/ir.model.access.csv",
        "views/one2many_search_configuration_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "one2many_search/static/src/js/x2many_search.js",
            "one2many_search/static/src/xml/x2many_search.xml",
            "one2many_search/static/src/scss/x2many_search.scss",
        ],
    },
    "images": ["static/description/banner.png"],
    "installable": True,
    "application": False,
}
