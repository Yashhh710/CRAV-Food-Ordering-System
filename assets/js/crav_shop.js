/* CRAV shop pages: renders products from assets/js/crav_menu.json
   and powers search, sort, category / price / stock / rating filters, pagination.
   Images come from assets/models/menu/                                          */
(function () {
    'use strict';

    var JSON_URL = 'assets/js/crav_menu.json';
    var IMG_DIR = 'assets/models/menu/';
    var FALLBACK_DESC = 'Freshly prepared and served hot, made with quality ingredients.';

    var listEl = document.getElementById('shop-products');
    if (!listEl) return;
    var pagEl = document.getElementById('shop-pagination');
    var layout = listEl.getAttribute('data-layout') || 'grid-3';
    var PAGE_SIZE = Infinity; // Show all products in one single page (pagination removed)

    var $ = function (id) { return document.getElementById(id); };
    var searchInput = $('searchInput');
    var sortSel = $('shop-sort');
    var catSel = $('shop-category');
    var sliderEl = document.querySelector('.js-range-slider');
    var fromInput = document.querySelector('.js-input-from');
    var toInput = document.querySelector('.js-input-to');
    var countEl = document.querySelector('.filter-row-2 h4');

    var items = [];
    var priceBounds = { min: 0, max: 0 };
    var state = {
        q: [], cats: new Set(), catSel: '', stock: new Set(), stars: new Set(),
        min: 0, max: Infinity, sort: 'default', page: 1
    };

    /* ---------- helpers ---------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function pick(o, keys) {
        for (var i = 0; i < keys.length; i++) {
            if (o[keys[i]] != null && o[keys[i]] !== '') return o[keys[i]];
        }
        return null;
    }
    function imgPath(v) {
        if (!v) return '';
        v = String(v);
        if (/^(https?:)?\/\//.test(v) || v.indexOf('assets/') === 0) return v;
        return IMG_DIR + v.split('/').pop();
    }
    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
        return isNaN(n) ? 0 : n;
    }
    function toStock(v) {
        if (v == null) return null;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v > 0;
        var s = String(v).toLowerCase();
        if (/^(out|no|false|0|unavailable|sold)/.test(s)) return false;
        if (/^(in|yes|true|available|\d)/.test(s)) return true;
        return null;
    }
    function pad2(n) { return n < 10 ? '0' + n : String(n); }
    function money(n) { return '\u20B9' + (Math.round(n * 100) / 100); }

    /* Accepts [items], [{category, items}], {categories:[...]}, {Category:[items]} */
    function normalize(data) {
        var out = [];
        function add(it, cat) {
            if (!it || typeof it !== 'object') return;
            out.push({
                id: pick(it, ['id', 'slug', 'sku']) || out.length + 1,
                name: String(pick(it, ['name', 'title', 'item_name']) || ''),
                desc: String(pick(it, ['short_description', 'description', 'desc', 'details']) || FALLBACK_DESC),
                img: imgPath(pick(it, ['image', 'img', 'photo', 'picture'])),
                price: num(pick(it, ['price', 'cost', 'amount'])),
                category: String(cat || pick(it, ['category', 'type', 'section']) || 'Menu'),
                rating: (function () {
                    var r = pick(it, ['rating', 'stars', 'review']);
                    return r == null ? null : num(r);
                })(),
                stock: toStock(pick(it, ['in_stock', 'inStock', 'available', 'availability', 'stock']))
            });
        }
        function walk(d, cat) {
            if (Array.isArray(d)) {
                d.forEach(function (x) {
                    var sub = x && (x.items || x.products);
                    if (Array.isArray(sub)) walk(sub, pick(x, ['name', 'category', 'title']));
                    else add(x, cat);
                });
            } else if (d && typeof d === 'object') {
                var list = d.categories || d.menu || d.items || d.products;
                if (Array.isArray(list)) return walk(list, cat);
                Object.keys(d).forEach(function (k) {
                    var v = d[k];
                    if (Array.isArray(v)) walk(v, k);
                    else if (v && Array.isArray(v.items)) walk(v.items, k);
                });
            }
        }
        walk(data, null);
        return out;
    }

    /* ---------- card templates ---------- */
    var QTY = '<div class="quantity quantity-wrap">' +
        '<div class="decrement"><i class="fa-solid fa-dash"></i></div>' +
        '<input type="text" name="quantity" value="1" maxlength="2" size="1" class="number">' +
        '<div class="increment"><i class="fa-solid fa-plus-large"></i></div></div>';
    var CART = '<a href="javascript:;" class="cart-btn cart-button"><img src="assets/media/icons/shopping-cart.png" alt=""></a>';
    var ARROW = '<svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M16.2522 11.9789C14.4658 10.1925 13.7513 6.14339 15.6567 4.23792M15.6567 4.23792C14.565 5.3296 11.4885 7.21521 7.91576 3.64246M15.6567 4.23792L4.34301 15.5516" stroke="#FCFDFD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function stars(n) {
        var s = '', r = Math.round(n);
        for (var i = 1; i <= 5; i++) s += '<i class="fa-' + (i <= r ? 'solid' : 'light') + ' fa-star"></i>';
        return s;
    }
    function imgTag(it) {
        return it.img ? '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" loading="lazy">' : '';
    }
    function dataAttrs(it) {
        return ' data-id="' + esc(it.id) + '" data-name="' + esc(it.name) + '" data-price="' + it.price + '" data-img="' + esc(it.img) + '"';
    }
    function card(it) {
        var wishBtn = '<button type="button" class="wishlist-toggle-btn" data-id="' + esc(it.id) + '" aria-label="Save to Wishlist" title="Save to Wishlist"><i class="fa-regular fa-heart"></i></button>';
        if (layout === 'list') {
            return '<div class="product-list-card item-card mb-32"' + dataAttrs(it) + '>' + wishBtn + '<div class="row">' +
                '<div class="col-md-4"><div class="product-img text-center">' + imgTag(it) + '</div></div>' +
                '<div class="col-md-8"><div class="info text-md-start text-center">' +
                '<h4 class="title mb-16">' + esc(it.name) + '</h4>' +
                (it.rating != null ? '<div class="rating mb-16">' + stars(it.rating) + '</div>' : '') +
                '<h4 class="price mb-24">' + money(it.price) + '</h4>' +
                '<p class="lead desc mb-32">' + esc(it.desc) + '</p>' +
                '<div class="action-block">' + QTY + CART +
                '<button type="button" class="cus-btn primary"><span class="icon-wrapper">' + ARROW +
                ARROW.replace('icon-svg"', 'icon-svg icon-svg-copy"') + '</span>Buy Now</button>' +
                '</div></div></div></div></div>';
        }
        var col = layout === 'grid-4' ? 'col-xl-3 col-lg-4 col-sm-6' : 'col-lg-4 col-sm-6';
        return '<div class="item-card ' + col + ' mb-32"' + dataAttrs(it) + '><div class="product-card text-center">' +
            wishBtn +
            '<div class="product-img mb-16">' + imgTag(it) + '</div>' +
            '<h5 class="title">' + esc(it.name) + '</h5>' +
            '<p class="desc">' + esc(it.desc) + '</p>' +
            '<div class="action-block">' + QTY +
            '<div class="price-cart"><h5>' + money(it.price) + '</h5>' + CART + '</div>' +
            '</div></div></div>';
    }

    /* ---------- filtering / sorting ---------- */
    function matches(it) {
        if (state.q.length) {
            var hay = (it.name + ' ' + it.desc + ' ' + it.category).toLowerCase();
            for (var i = 0; i < state.q.length; i++) if (hay.indexOf(state.q[i]) < 0) return false;
        }
        if (state.cats.size && !state.cats.has(it.category)) return false;
        if (state.catSel && it.category !== state.catSel) return false;
        if (it.price < state.min || it.price > state.max) return false;
        if (state.stock.size) {
            if (it.stock === null) return false;
            if (!state.stock.has(it.stock ? 'in' : 'out')) return false;
        }
        if (state.stars.size) {
            if (it.rating == null || !state.stars.has(Math.round(it.rating))) return false;
        }
        return true;
    }
    function sorted(arr) {
        var a = arr.slice();
        switch (state.sort) {
            case 'az': a.sort(function (x, y) { return x.name.localeCompare(y.name); }); break;
            case 'za': a.sort(function (x, y) { return y.name.localeCompare(x.name); }); break;
            case 'plow': a.sort(function (x, y) { return x.price - y.price; }); break;
            case 'phigh': a.sort(function (x, y) { return y.price - x.price; }); break;
        }
        return a;
    }

    function render() {
        var res = sorted(items.filter(matches));
        listEl.innerHTML = res.length ? res.map(card).join('') :
            '<div class="col-12"><div class="text-center py-5">' +
            '<i class="fa-light fa-magnifying-glass" style="font-size: 48px; color: #ccc; margin-bottom: 16px; display: inline-block;"></i>' +
            '<h4 class="mb-12">No items found</h4>' +
            '<p class="lead mb-24">We couldn\'t find any menu items matching your search or filters.</p>' +
            '<button type="button" class="cus-btn primary" id="clear-search-btn">Reset Filters</button>' +
            '</div></div>';

        if (pagEl) {
            pagEl.innerHTML = '';
            pagEl.style.display = 'none';
        }
        if (countEl) countEl.textContent = state.q.length ? ('Search Results (' + res.length + ')') : ('All Products (' + res.length + ')');

        if (window.ScrollTrigger) requestAnimationFrame(function () { ScrollTrigger.refresh(); });
        if (window.updateWishlistUI) window.updateWishlistUI();
    }
    function update() { state.page = 1; render(); }

    /* ---------- sidebar widgets ---------- */
    function checkList(listId, rows, prefix) {
        var ul = $(listId);
        if (!ul) return;
        ul.innerHTML = rows.map(function (r, i) {
            return '<li><div class="filter-checkbox"><input type="checkbox" id="' + prefix + i +
                '" data-value="' + esc(r.value) + '"><label' + (r.cls ? ' class="' + r.cls + '"' : '') +
                ' for="' + prefix + i + '">' + r.label + '</label></div><p class="lead">(' + pad2(r.count) + ')</p></li>';
        }).join('');
    }
    function hideWidget(key) {
        var w = $('widget-' + key);
        if (w) w.style.display = 'none';
    }
    function bindChecks(listId, set, parse) {
        var ul = $(listId);
        if (!ul) return;
        ul.addEventListener('change', function (e) {
            var v = parse(e.target.getAttribute('data-value'));
            if (e.target.checked) set.add(v); else set.delete(v);
            update();
        });
    }

    function buildSidebar() {
        // categories
        var cats = [], counts = {};
        items.forEach(function (it) {
            if (!counts[it.category]) { counts[it.category] = 0; cats.push(it.category); }
            counts[it.category]++;
        });
        checkList('filter-categories', cats.map(function (c) {
            return { value: c, label: esc(c), count: counts[c] };
        }), 'cat-');
        bindChecks('filter-categories', state.cats, String);

        // category dropdown (page without sidebar)
        if (catSel) {
            catSel.innerHTML = '<option value="">All Categories</option>' + cats.map(function (c) {
                return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
            }).join('');
            if (window.jQuery && jQuery.fn.niceSelect) { try { jQuery(catSel).niceSelect('update'); } catch (e) {} }
            catSel.addEventListener('change', function () { state.catSel = catSel.value; update(); });
        }

        // availability (only when data has stock info)
        var hasStock = items.some(function (i) { return i.stock !== null; });
        if (hasStock) {
            var inC = items.filter(function (i) { return i.stock === true; }).length;
            var outC = items.filter(function (i) { return i.stock === false; }).length;
            checkList('filter-availability', [
                { value: 'in', label: 'In Stock', count: inC },
                { value: 'out', label: 'Out of Stock', count: outC }
            ], 'stock-');
            bindChecks('filter-availability', state.stock, String);
        } else hideWidget('availability');

        // reviews (only when data has ratings)
        var hasRating = items.some(function (i) { return i.rating != null; });
        if (hasRating) {
            var rows = [5, 4, 3, 2, 1].map(function (n) {
                return {
                    value: n, cls: 'rating', label: stars(n),
                    count: items.filter(function (i) { return i.rating != null && Math.round(i.rating) === n; }).length
                };
            });
            checkList('filter-reviews', rows, 'star-');
            bindChecks('filter-reviews', state.stars, Number);
        } else hideWidget('reviews');

        buildPrice();
    }

    function buildPrice() {
        if (!items.length) return;
        var prices = items.map(function (i) { return i.price; });
        var min = Math.floor(Math.min.apply(null, prices));
        var max = Math.ceil(Math.max.apply(null, prices));
        if (max <= min) max = min + 1;
        priceBounds = { min: min, max: max };
        state.min = min; state.max = max;
        if (fromInput) fromInput.value = min;
        if (toInput) toInput.value = max;
        if (!sliderEl) return;

        function onSlide(d) {
            state.min = d.from; state.max = d.to;
            if (fromInput) fromInput.value = d.from;
            if (toInput) toInput.value = d.to;
            update();
        }
        if (window.jQuery && jQuery.fn.ionRangeSlider) {
            var $s = jQuery(sliderEl);
            var opts = {
                type: 'double', min: min, max: max, from: min, to: max, step: 1,
                prefix: '\u20B9', onChange: onSlide, onFinish: onSlide
            };
            var inst = $s.data('ionRangeSlider');
            if (inst) inst.update(opts); else $s.ionRangeSlider(opts);

            function fromInputs() {
                var f = Math.min(Math.max(num(fromInput.value), min), max);
                var t = Math.min(Math.max(num(toInput.value), min), max);
                if (f > t) { var x = f; f = t; t = x; }
                fromInput.value = f; toInput.value = t;
                var s = $s.data('ionRangeSlider');
                if (s) s.update({ from: f, to: t });
                state.min = f; state.max = t;
                update();
            }
            if (fromInput) fromInput.addEventListener('change', fromInputs);
            if (toInput) toInput.addEventListener('change', fromInputs);
        }
    }

    /* ---------- search, sort, qty, cart ---------- */
    function setQuery(v) {
        state.q = String(v || '').toLowerCase().split(/\s+/).filter(Boolean);
    }
    var timer;
    if (searchInput) {
        searchInput.removeAttribute('required');
        var onSearch = function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                setQuery(searchInput.value);
                render();
            }, 80);
        };
        searchInput.addEventListener('input', onSearch);
        searchInput.addEventListener('search', function () { setQuery(searchInput.value); render(); });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(timer);
                setQuery(searchInput.value);
                render();
            }
        });
        var btn = document.querySelector('.search-field .search-btn');
        if (btn) btn.addEventListener('click', function (e) {
            e.preventDefault();
            clearTimeout(timer);
            setQuery(searchInput.value);
            render();
        });
    }
    if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; update(); });

    // Handle Reset / Clear search button if clicked
    listEl.addEventListener('click', function (e) {
        if (e.target.closest('#clear-search-btn')) {
            if (searchInput) searchInput.value = '';
            state.q = [];
            state.cats.clear();
            state.catSel = '';
            state.stock.clear();
            state.stars.clear();
            if (catSel) {
                catSel.value = '';
                if (window.jQuery && jQuery.fn.niceSelect) { try { jQuery(catSel).niceSelect('update'); } catch (err) {} }
            }
            document.querySelectorAll('#filter-categories input, #filter-availability input, #filter-reviews input').forEach(function (cb) {
                cb.checked = false;
            });
            render();
        }
    });

    // quantity +/- and cart button (cards are created dynamically)
    listEl.addEventListener('click', function (e) {
        var inc = e.target.closest('.increment'), dec = e.target.closest('.decrement');
        if (inc || dec) {
            e.stopPropagation();
            var input = (inc || dec).parentNode.querySelector('input.number');
            var v = parseInt(input.value, 10) || 1;
            input.value = inc ? Math.min(99, v + 1) : Math.max(1, v - 1);
            return;
        }
    });

    // header search popup -> filter products on this page or redirect
    var popup = document.querySelector('.search-popup__form');
    if (popup) popup.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = (document.getElementById('search') || popup.querySelector('input') || {}).value || '';
        v = v.trim();
        if (searchInput) {
            searchInput.value = v;
            setQuery(v);
            render();
            var pEl = document.querySelector('.search-popup');
            if (pEl) pEl.classList.remove('active');
            document.body.classList.remove('locked');
        } else {
            window.location.href = 'shop-grid.html?q=' + encodeURIComponent(v);
        }
    });

    /* ---------- load ---------- */
    listEl.innerHTML = '<div class="col-12"><p class="lead text-center py-5">Loading menu\u2026</p></div>';

    fetch(JSON_URL)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) {
            items = normalize(data);
            var sp = new URLSearchParams(window.location.search);
            var q = sp.get('q') || sp.get('search');
            if (q && searchInput) { searchInput.value = q; setQuery(q); }
            buildSidebar();
            render();
        })
        .catch(function (e) {
            listEl.innerHTML = '<div class="col-12"><p class="lead text-center py-5">Menu could not be loaded.</p></div>';
            console.error('CRAV shop load failed:', e);
        });
})();
