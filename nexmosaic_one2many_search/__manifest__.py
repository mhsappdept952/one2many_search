{
    "name": "One2many Search Widget",
    "summary": "Search configured One2many lines instantly",
    "version": "18.0.1.0.0",
    "category": "Tools",
    "author": "NexMosaic Technologies",
    "license": "LGPL-3",
    "icon": "/nexmosaic_one2many_search/static/description/icon.png",
    "depends": ["web"],
    "data": [
        "security/ir.model.access.csv",
        "views/one2many_search_configuration_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "nexmosaic_one2many_search/static/src/js/x2many_search.js",
            "nexmosaic_one2many_search/static/src/xml/x2many_search.xml",
            "nexmosaic_one2many_search/static/src/scss/x2many_search.scss",
        ],
    },
    "images": ["static/description/banner.png"],
    "installable": True,
    "application": False,
}
