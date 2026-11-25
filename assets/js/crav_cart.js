/* CRAV cart, coupons, checkout, payment (demo) and live order tracking.
   Everything is stored in localStorage, so it works across all pages.
   Pages it powers:
     - every page   : mini cart (#sidebar-cart), header cart badge, "add to cart" buttons
     - cart.html    : #cart-page
     - checkout.html: #checkout-form + #checkout-summary
     - order-tracking.html : #tracking-root
   Delivery partners come from assets/js/deliveryboy.json                      */
(function () {
    'use strict';

    /* ================= config ================= */
    var KEY_CART = 'crav_cart';
    var KEY_COUPON = 'crav_coupon';
    var KEY_ORDERS = 'crav_orders';
    var DELIVERY_JSON = 'assets/js/deliveryboy.json';

    var DELIVERY_FEE = 40;
    var FREE_DELIVERY_ABOVE = 500;

    // type: percent | flat | delivery   (min = minimum cart subtotal, max = max discount)
    var COUPONS = {
        CRAV10:    { type: 'percent',  value: 10, min: 199, max: 100, label: '10% off (up to \u20B9100)' },
        WELCOME50: { type: 'flat',     value: 50, min: 299,           label: '\u20B950 off on orders above \u20B9299' },
        ROYAL20:   { type: 'percent',  value: 20, min: 599, max: 200, label: '20% off (up to \u20B9200)' },
        FREEDEL:   { type: 'delivery',            min: 0,             label: 'Free delivery' }
    };

    /* Order tracking timeline (6 stages matching production requirements) */
    var STAGES = [
        { key: 'confirmed', title: 'Order Confirmed',      text: 'We have received and confirmed your order.',            at: 0,   icon: 'fa-circle-check' },
        { key: 'preparing', title: 'Preparing Your Food',  text: 'Your food is being freshly prepared in our kitchen.',   at: 15,  icon: 'fa-utensils' },
        { key: 'packed',    title: 'Food Packed',          text: 'Packed hot with tamper-proof seal.',                   at: 35,  icon: 'fa-box' },
        { key: 'out',       title: 'Out for Delivery',     text: 'Your delivery partner is on the way to your doorstep.', at: 65,  icon: 'fa-motorcycle' },
        { key: 'arriving',  title: 'Arriving Soon',        text: 'Delivery partner is within 2 minutes of your location.',at: 100, icon: 'fa-location-dot' },
        { key: 'delivered', title: 'Delivered',            text: 'Delivered! Enjoy your delicious CRAV meal.',           at: 140, icon: 'fa-house-chimney' }
    ];

    var ARROW = '<svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M16.2522 11.9789C14.4658 10.1925 13.7513 6.14339 15.6567 4.23792M15.6567 4.23792C14.565 5.3296 11.4885 7.21521 7.91576 3.64246M15.6567 4.23792L4.34301 15.5516" stroke="#FCFDFD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function btnIcons() { return '<span class="icon-wrapper">' + ARROW + ARROW.replace('icon-svg"', 'icon-svg icon-svg-copy"') + '</span>'; }

    /* ================= helpers ================= */
    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function money(n) {
        n = Math.round((Number(n) || 0) * 100) / 100;
        return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
    }
    function slug(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; }
    function load(key, fallback) {
        try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
    }
    function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
    function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }

    /* ================= cart state ================= */
    function getCart() { var c = load(KEY_CART, []); return Array.isArray(c) ? c : []; }
    function setCart(c) { save(KEY_CART, c); renderAll(); }
    function getCouponCode() { return load(KEY_COUPON, ''); }

    function addItem(item, qty) {
        qty = Math.max(1, parseInt(qty, 10) || 1);
        var cart = getCart(), found = null;
        cart.forEach(function (c) { if (c.id === item.id) found = c; });
        if (found) found.qty = Math.min(99, found.qty + qty);
        else cart.push({ id: item.id, name: item.name, price: item.price, img: item.img || '', qty: Math.min(99, qty) });
        setCart(cart);
    }
    function setQty(id, qty) {
        var cart = getCart();
        cart.forEach(function (c) { if (c.id === id) c.qty = Math.max(1, Math.min(99, qty)); });
        setCart(cart);
    }
    function removeItem(id) { setCart(getCart().filter(function (c) { return c.id !== id; })); }
    function clearCart() { remove(KEY_COUPON); setCart([]); }

    /* ================= totals & coupons ================= */
    function totals() {
        var cart = getCart();
        var subtotal = 0, count = 0;
        cart.forEach(function (c) { subtotal += c.price * c.qty; count += c.qty; });

        var code = getCouponCode(), cp = code ? COUPONS[code] : null;
        var discount = 0, freeDelivery = false, couponError = '';
        if (cp) {
            if (subtotal < cp.min) {
                couponError = 'Add ' + money(cp.min - subtotal) + ' more to use ' + code + '.';
            } else if (cp.type === 'percent') {
                discount = Math.round(subtotal * cp.value / 100);
                if (cp.max) discount = Math.min(discount, cp.max);
            } else if (cp.type === 'flat') {
                discount = Math.min(cp.value, subtotal);
            } else if (cp.type === 'delivery') {
                freeDelivery = true;
            }
        }
        var delivery = 0;
        if (count > 0) delivery = (subtotal >= FREE_DELIVERY_ABOVE || freeDelivery) ? 0 : DELIVERY_FEE;
        var total = Math.max(0, subtotal - discount + delivery);
        return {
            cart: cart, count: count, subtotal: subtotal, discount: discount, delivery: delivery,
            total: total, code: cp ? code : '', coupon: cp, couponError: couponError, freeDelivery: freeDelivery
        };
    }

    function applyCoupon(raw) {
        var code = String(raw || '').trim().toUpperCase();
        if (!code) return { ok: false, msg: 'Enter a coupon code.' };
        var cp = COUPONS[code];
        if (!cp) return { ok: false, msg: 'Invalid coupon code.' };
        var sub = totals().subtotal;
        if (sub < cp.min) return { ok: false, msg: 'Add ' + money(cp.min - sub) + ' more to use ' + code + '.' };
        save(KEY_COUPON, code);
        renderAll();
        return { ok: true, msg: code + ' applied!' };
    }
    function removeCoupon() { remove(KEY_COUPON); renderAll(); }

    /* ================= toast ================= */
    var toastTimer;
    function toast(msg) {
        var t = $('#cc-toast');
        if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
        t.textContent = msg;
        t.className = 'show';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.className = ''; }, 2200);
    }

    /* ================= shared HTML builders ================= */
    function emptyState(title, text) {
        return '<div class="cc-empty">' +
            '<div class="cc-empty-icon"><i class="fa-regular fa-cart-shopping"></i></div>' +
            '<h4>' + esc(title) + '</h4><p class="lead">' + esc(text) + '</p>' +
            '<a href="shop-grid.html" class="cus-btn primary">' + btnIcons() + 'Browse Menu</a></div>';
    }

    function couponBox(t, opts) {
        opts = opts || {};
        var h = '<div class="cc-coupon">';
        if (t.code && !t.couponError) {
            h += '<div class="cc-coupon-applied"><span><i class="fa-solid fa-tag"></i> <b>' + esc(t.code) + '</b> \u2013 ' +
                esc(t.coupon.label) + '</span><button type="button" data-cc="remove-coupon">Remove</button></div>';
        } else {
            h += '<div class="cc-coupon-form"><input type="text" class="cc-coupon-input" placeholder="Coupon code" maxlength="20" autocomplete="off" value="' +
                esc(t.code || '') + '"><button type="button" data-cc="apply-coupon">Apply</button></div>';
            if (t.couponError) h += '<div class="cc-coupon-msg err">' + esc(t.couponError) + '</div>';
            else h += '<div class="cc-coupon-msg"></div>';
        }
        if (opts.chips) {
            h += '<div class="cc-chips">' + Object.keys(COUPONS).map(function (k) {
                return '<button type="button" class="cc-chip" data-cc="use-coupon" data-code="' + k + '" title="' + esc(COUPONS[k].label) + '">' + k + '</button>';
            }).join('') + '</div>';
        }
        return h + '</div>';
    }

    function summaryRows(t) {
        var h = '<div class="d-flex justify-content-between align-items-center mb-16"><p class="lead color-black">SUBTOTAL</p><p class="lead">' + money(t.subtotal) + '</p></div>';
        h += '<div class="d-flex justify-content-between align-items-center mb-16"><p class="lead color-black">DELIVERY</p><p class="lead">' +
            (t.delivery ? money(t.delivery) : '<span class="cc-free">FREE</span>') + '</p></div>';
        if (t.discount) {
            h += '<div class="d-flex justify-content-between align-items-center mb-16"><p class="lead color-black">COUPON (' + esc(t.code) + ')</p><p class="lead cc-green">-' + money(t.discount) + '</p></div>';
        }
        if (t.delivery && t.subtotal < FREE_DELIVERY_ABOVE) {
            h += '<p class="cc-note">Add ' + money(FREE_DELIVERY_ABOVE - t.subtotal) + ' more for free delivery.</p>';
        }
        return h;
    }

    /* ================= header badge ================= */
    function renderBadge(t) {
        $$('.ui-header-tools-item.cart-button').forEach(function (a) {
            var b = $('.cc-badge', a);
            if (!b) { b = document.createElement('span'); b.className = 'cc-badge'; a.appendChild(b); }
            b.textContent = t.count > 99 ? '99+' : t.count;
            b.style.display = t.count ? '' : 'none';
        });
    }

    /* ================= mini cart (sidebar) ================= */
    function prepMiniCart() {
        var aside = $('#sidebar-cart');
        if (!aside || $('#cc-mini-body', aside)) return;
        // keep the title row + close button (app.js already bound it); replace the rest
        var kids = Array.prototype.slice.call(aside.children);
        kids.forEach(function (k, i) { if (i >= 2) aside.removeChild(k); });
        var body = document.createElement('div');
        body.id = 'cc-mini-body';
        aside.appendChild(body);
    }
    function renderMini(t) {
        var body = $('#cc-mini-body');
        if (!body) return;
        if (!t.cart.length) {
            body.innerHTML = '<div class="cc-mini-empty">' + emptyState('Your cart is empty', 'Add something tasty to get started.') + '</div>';
            return;
        }
        var list = t.cart.map(function (c) {
            return '<li class="product-item mb-24"><span class="item-image">' +
                (c.img ? '<img src="' + esc(c.img) + '" alt="' + esc(c.name) + '">' : '') + '</span>' +
                '<div class="product-text"><div class="d-flex justify-content-between align-items-start gap-2">' +
                '<h6 class="mb-16 dark-gray">' + esc(c.name) + '</h6>' +
                '<button type="button" class="cc-x" data-cc="remove" data-id="' + esc(c.id) + '" aria-label="Remove"><i class="fa-regular fa-xmark"></i></button></div>' +
                '<div class="qp_row">' + qtyBox(c) + '<h5 class="dark-gray">' + money(c.price * c.qty) + '</h5></div></div></li>';
        }).join('');
        body.innerHTML = '<ul class="product-list">' + list + '</ul>' +
            '<div class="cc-mini-foot">' + couponBox(t) +
            '<div class="cc-mini-rows">' + summaryRows(t) + '</div>' +
            '<div class="price-total mb-24"><h6>Total</h6><h5 class="color-primary">' + money(t.total) + '</h5></div>' +
            '<div class="action-buttons">' +
            '<a href="cart.html" class="cus-btn outline">' + btnIcons() + 'View Cart</a>' +
            '<a href="checkout.html" class="cus-btn dark">' + btnIcons() + 'Checkout</a></div></div>';
    }
    function qtyBox(c) {
        return '<div class="quantity quantity-wrap cc-qty"><div class="cc-dec" data-cc="dec" data-id="' + esc(c.id) + '"><i class="fa-solid fa-dash"></i></div>' +
            '<input type="text" class="number" value="' + c.qty + '" maxlength="2" size="1" data-cc="qty" data-id="' + esc(c.id) + '">' +
            '<div class="cc-inc" data-cc="inc" data-id="' + esc(c.id) + '"><i class="fa-solid fa-plus-large"></i></div></div>';
    }

    /* ================= cart page ================= */
    function renderCartPage(t) {
        var root = $('#cart-page');
        if (!root) return;
        if (!t.cart.length) { root.innerHTML = '<div class="row"><div class="col-12">' + emptyState('Your cart is empty', 'Looks like you haven\u2019t added anything yet. Pick something delicious from our menu!') + '</div></div>'; return; }

        var rows = t.cart.map(function (c) {
            return '<tr><td class="product-block"><a href="#" class="remove-from-cart-btn" data-cc="remove" data-id="' + esc(c.id) + '"><i class="fa-light fa-xmark"></i></a>' +
                (c.img ? '<img src="' + esc(c.img) + '" alt="">' : '') + '<span class="h6">' + esc(c.name) + '</span></td>' +
                '<td><p class="lead color-black">' + money(c.price) + '</p></td><td>' + qtyBox(c) + '</td>' +
                '<td><h6>' + money(c.price * c.qty) + '</h6></td></tr>';
        }).join('');
        var cards = t.cart.map(function (c) {
            return '<div class="col-lg-6 col-sm-6"><div class="cart-item-card text-center mb-32">' +
                '<a href="#" class="remove-from-cart-btn" data-cc="remove" data-id="' + esc(c.id) + '"><i class="fa-light fa-xmark"></i></a>' +
                '<div class="product-img mb-16">' + (c.img ? '<img src="' + esc(c.img) + '" alt="" class="mx-auto">' : '') + '</div>' +
                '<span class="h5 title mb-24 d-block">' + esc(c.name) + '</span>' +
                '<div class="d-flex justify-content-between align-items-center mb-16"><h6>Price:</h6><p class="lead color-black">' + money(c.price) + '</p></div>' +
                '<div class="d-flex justify-content-between align-items-center mb-16"><h6>Quantity:</h6>' + qtyBox(c) + '</div>' +
                '<div class="d-flex justify-content-between align-items-center"><h6>Total:</h6><h6>' + money(c.price * c.qty) + '</h6></div></div></div>';
        }).join('');

        root.innerHTML = '<div class="row"><div class="col-lg-8 mb-64 mb-lg-0">' +
            '<div class="d-xl-block d-none mb-64"><table class="table cart-table"><thead><tr><th class="h6">PRODUCT</th><th class="h6">PRICE</th><th class="h6">QUANTITY</th><th class="h6">SUBTOTAL</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<div class="d-xl-none d-block mb-32"><div class="row">' + cards + '</div></div>' +
            '<div class="d-flex flex-wrap gap-3"><a href="shop-grid.html" class="cus-btn primary">' + btnIcons() + 'Continue Shopping</a>' +
            '<button type="button" class="cus-btn outline" data-cc="clear">' + btnIcons() + 'Clear Cart</button></div></div>' +
            '<div class="col-lg-4"><div class="cart-summary"><h6 class="title mb-24">ORDER SUMMARY</h6>' +
            couponBox(t, { chips: true }) +
            '<div class="cart-summary-detail mb-24">' + summaryRows(t) + '</div>' +
            '<div class="d-flex justify-content-between align-items-center mb-48"><h5 class="color-primary">TOTAL</h5><h5 class="color-primary">' + money(t.total) + '</h5></div>' +
            '<a href="checkout.html" class="cus-btn dark">' + btnIcons() + 'Proceed To Checkout</a></div></div></div>';
    }

    /* ================= checkout ================= */
    var pay = { method: 'qr' };
    var qrPollTimer = null;

    function renderCheckout(t) {
        var form = $('#checkout-form');
        if (!form) return;
        var wrap = $('#checkout-empty');
        if (!t.cart.length && !form.hasAttribute('data-done')) {
            form.style.display = 'none';
            if (!wrap) { wrap = document.createElement('div'); wrap.id = 'checkout-empty'; form.parentNode.insertBefore(wrap, form); }
            wrap.innerHTML = emptyState('Nothing to checkout', 'Your cart is empty. Add some items first.');
            return;
        }
        if (wrap) { wrap.parentNode.removeChild(wrap); form.style.display = ''; }

        var dyn = $('#cs-dynamic');
        if (!dyn) return;
        var items = t.cart.map(function (c) {
            return '<div class="d-flex justify-content-between align-items-center mb-16"><p class="lead color-black">' + esc(c.name) + ' \u00D7 ' + c.qty +
                '</p><p class="lead">' + money(c.price * c.qty) + '</p></div>';
        }).join('');
        dyn.innerHTML = '<div class="cart-summary-detail mb-24">' + items + '<div class="vr-line mb-16"></div>' + summaryRows(t) + '</div>' +
            couponBox(t, { chips: true }) +
            '<div class="d-flex justify-content-between align-items-center mb-32"><h5 class="color-primary">TOTAL</h5><h5 class="color-primary">' + money(t.total) + '</h5></div>';
        var lbl = $('#cs-btn-label');
        if (lbl) {
            if (pay.method === 'qr') lbl.textContent = 'Generate Demo QR (' + money(t.total) + ')';
            else if (pay.method === 'cod') lbl.textContent = 'Place Order';
            else lbl.textContent = 'Pay ' + money(t.total);
        }
    }

    function prefillCheckoutUser(form) {
        if (!window.CravAuth || !window.CravAuth.isLoggedIn()) return;
        var user = window.CravAuth.getUser();
        if (!user) return;

        var setVal = function (name, val) {
            var el = form.querySelector('[name="' + name + '"]');
            if (el && val && !el.value) el.value = val;
        };

        setVal('f-name', user.firstName);
        setVal('l-name', user.lastName);
        setVal('email', user.email);
        setVal('phone', user.phone);

        // Fetch saved addresses
        window.CravAuth.fetchProfile().then(function (res) {
            if (res && res.addresses && res.addresses.length) {
                var def = res.addresses.find(function (a) { return a.isDefault; }) || res.addresses[0];
                if (def) {
                    setVal('address', def.address);
                    setVal('address2', def.address2);
                    setVal('state', def.state);
                    setVal('zipcode', def.zipcode);
                }
            }
        }).catch(function () {});
    }

    function initCheckout() {
        var form = $('#checkout-form');
        if (!form) return;

        // Auto prefill if authenticated
        prefillCheckoutUser(form);

        var box = $('#checkout-summary');
        box.innerHTML = '<h6 class="title mb-24">ORDER SUMMARY</h6><div id="cs-dynamic"></div>' +
            '<h6 class="mb-16">PAYMENT METHOD</h6><div class="payment-method mb-24 cc-pay"><ul class="unstyled">' +
            payOpt('qr', '<span><i class="fa-solid fa-qrcode color-primary me-2"></i> Demo UPI QR Payment <span class="badge bg-warning text-dark ms-2" style="font-size:10px;">POPULAR</span></span>',
                '<p class="cc-note mb-2" style="font-size:12px;">Generates an instant QR code. Scan using Google Lens or any mobile QR scanner to open the CRAV Demo Payment page.</p>') +
            payOpt('upi', 'UPI ID (GPay / PhonePe / Paytm)', '<input type="text" id="pay-upi" class="cc-input" placeholder="yourname@upi" autocomplete="off">') +
            payOpt('card', 'Credit / Debit Card', '<input type="text" id="pay-card" class="cc-input" placeholder="Card number" inputmode="numeric" maxlength="19" autocomplete="off">' +
                '<div class="cc-row"><input type="text" id="pay-exp" class="cc-input" placeholder="MM/YY" maxlength="5" autocomplete="off"><input type="password" id="pay-cvv" class="cc-input" placeholder="CVV" maxlength="3" inputmode="numeric" autocomplete="off"></div>') +
            payOpt('cod', 'Cash on Delivery', '<p class="cc-note">Pay in cash when your order arrives.</p>') +
            '</ul></div><div class="cc-form-error" id="cs-error"></div>' +
            '<button type="submit" class="cus-btn dark w-100">' + btnIcons() + '<span id="cs-btn-label">Generate Demo QR</span></button>';

        $$('input[name="paymethod"]', box).forEach(function (r) {
            r.addEventListener('change', function () { pay.method = r.value; syncPay(); renderCheckout(totals()); });
        });
        var card = $('#pay-card'), exp = $('#pay-exp');
        if (card) {
            card.addEventListener('input', function () {
                var d = card.value.replace(/\D/g, '').slice(0, 16);
                card.value = d.replace(/(.{4})/g, '$1 ').trim();
            });
        }
        if (exp) {
            exp.addEventListener('input', function () {
                var d = exp.value.replace(/\D/g, '').slice(0, 4);
                exp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
            });
        }
        syncPay();

        form.removeAttribute('action');
        form.setAttribute('novalidate', 'novalidate');
        form.addEventListener('submit', function (e) { e.preventDefault(); submitOrder(form); });
    }
    function payOpt(val, label, inner) {
        return '<li class="cc-pay-opt" data-m="' + val + '"><label class="lead"><input type="radio" class="radio" name="paymethod" value="' + val + '"' +
            (val === pay.method ? ' checked' : '') + '>' + label + '</label><div class="cc-pay-fields">' + inner + '</div></li>';
    }
    function syncPay() {
        $$('.cc-pay-opt').forEach(function (li) { li.classList.toggle('open', li.getAttribute('data-m') === pay.method); });
    }

    function fv(form, name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value.trim() : ''; }
    function submitOrder(form) {
        var err = $('#cs-error');
        function fail(msg, el) { err.textContent = msg; if (el) el.focus(); return false; }
        err.textContent = '';
        var t = totals();
        if (!t.cart.length) return fail('Your cart is empty.');

        var f = {
            firstName: fv(form, 'f-name'), lastName: fv(form, 'l-name'), email: fv(form, 'email'), phone: fv(form, 'phone'),
            address: fv(form, 'address'), address2: fv(form, 'address2'), state: fv(form, 'state'), zip: fv(form, 'zipcode'),
            note: fv(form, 'noe')
        };
        var el = function (n) { return form.querySelector('[name="' + n + '"]'); };
        if (!f.firstName) return fail('Please enter your first name.', el('f-name'));
        if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return fail('Please enter a valid email.', el('email'));
        if (!f.address) return fail('Please enter your delivery address.', el('address'));
        if (!f.state) return fail('Please enter your state.', el('state'));
        if (!/^\d{6}$/.test(f.zip)) return fail('Please enter a valid 6-digit PIN code.', el('zipcode'));

        if (pay.method === 'qr') {
            // Initiate Demo QR Payment with Server
            showQrOverlay(t, f);
            return;
        }

        var paymentLabel, paid;
        if (pay.method === 'upi') {
            if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test($('#pay-upi').value.trim())) return fail('Please enter a valid UPI ID (e.g. name@upi).', $('#pay-upi'));
            paymentLabel = 'UPI'; paid = true;
        } else if (pay.method === 'card') {
            var digits = $('#pay-card').value.replace(/\D/g, '');
            if (digits.length !== 16) return fail('Please enter a valid 16-digit card number.', $('#pay-card'));
            var m = /^(\d{2})\/(\d{2})$/.exec($('#pay-exp').value);
            if (!m || +m[1] < 1 || +m[1] > 12) return fail('Please enter a valid expiry date (MM/YY).', $('#pay-exp'));
            if (!/^\d{3}$/.test($('#pay-cvv').value)) return fail('Please enter a valid 3-digit CVV.', $('#pay-cvv'));
            paymentLabel = 'Card \u2022\u2022\u2022\u2022 ' + digits.slice(-4); paid = true;
        } else { paymentLabel = 'Cash on Delivery'; paid = false; }

        showOverlay(paid ? 'processing' : 'placing', t);
        var order = {
            id: 'CRV' + String(Math.floor(100000 + Math.random() * 900000)),
            placedAt: Date.now(),
            items: t.cart.map(function (c) { return { id: c.id, name: c.name, price: c.price, qty: c.qty, img: c.img }; }),
            subtotal: t.subtotal, discount: t.discount, delivery: t.delivery, total: t.total, coupon: t.code,
            customer: f, payment: { method: paymentLabel, status: paid ? 'Paid' : 'Pay on delivery' },
            deliveryBoy: null
        };
        assignDeliveryBoy(order.id).then(function (boy) {
            order.deliveryBoy = boy;
            
            var token = window.CravAuth ? window.CravAuth.getToken() : null;
            var headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            // Save order to server database in real time
            fetch('/api/orders', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(order)
            })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.order) {
                    order = res.order;
                }
            })
            .catch(function (err) {
                console.warn('Server order sync notice:', err);
            })
            .finally(function () {
                var orders = load(KEY_ORDERS, []);
                orders = orders.filter(function (o) { return o.id !== order.id; });
                orders.unshift(order);
                save(KEY_ORDERS, orders);
                form.setAttribute('data-done', '1');
                clearCart();
                showOverlay('success', t, order);
            });
        });
    }

    function showQrOverlay(t, customer) {
        clearInterval(qrPollTimer);
        var o = $('#cc-overlay');
        if (!o) { o = document.createElement('div'); o.id = 'cc-overlay'; document.body.appendChild(o); }
        o.className = 'show';

        o.innerHTML = '<div class="cc-qr-card">' +
            '<div class="cc-spinner mb-3"></div>' +
            '<h4>Generating Demo Payment QR...</h4>' +
            '<p class="lead">Creating unique session for ' + money(t.total) + '...</p>' +
            '</div>';

        var orderPayload = {
            items: t.cart,
            subtotal: t.subtotal,
            discount: t.discount,
            delivery: t.delivery,
            total: t.total,
            coupon: t.code,
            customer: customer
        };

        var token = window.CravAuth ? window.CravAuth.getToken() : null;
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        fetch('/api/payments/create-demo-qr', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(orderPayload)
        })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (!res.success) throw new Error(res.message || 'Could not generate QR');
            renderActiveQrScreen(o, res, t, customer);
        })
        .catch(function (err) {
            console.error('Server QR creation failed, using client demo fallback:', err);
            // Standalone fallback
            var fallbackId = 'CRV-DEMO-' + Math.floor(100000 + Math.random() * 900000);
            var mobileUrl = window.location.origin + '/pay-mobile.html?orderId=' + fallbackId + '&amount=' + encodeURIComponent(t.total);
            var qrImg = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' + encodeURIComponent(mobileUrl);
            renderActiveQrScreen(o, {
                orderId: fallbackId,
                total: t.total,
                qrCodeDataUrl: qrImg,
                mobilePayUrl: mobileUrl
            }, t, customer);
        });
    }

    function renderActiveQrScreen(o, data, t, customer) {
        var orderId = data.orderId;
        o.innerHTML = '<div class="cc-qr-card">' +
            '<span class="cc-qr-pill"><i class="fa-solid fa-graduation-cap"></i> Academic Demo Simulation</span>' +
            '<h4 class="mb-1" style="color:#D90019; font-weight:700;">Scan to Pay</h4>' +
            '<p class="lead mb-2" style="font-size:15px;">Order <b>#' + esc(orderId) + '</b> &bull; <span style="color:#D90019; font-weight:700;">' + money(data.total) + '</span></p>' +
            '<div class="cc-qr-img-box">' +
            '<img src="' + esc(data.qrCodeDataUrl) + '" alt="CRAV Demo Payment QR">' +
            '</div>' +
            '<div class="d-block">' +
            '<div class="cc-qr-status" id="qr-live-status"><div class="pulse-dot"></div> Waiting for mobile payment...</div>' +
            '</div>' +
            '<p class="cc-qr-instructions">Scan using <b>Google Lens</b> or your phone camera to open the mobile CRAV checkout.</p>' +
            '<div class="mb-3">' +
            '<a href="' + esc(data.mobilePayUrl) + '" target="_blank" class="cc-qr-test-btn"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Mobile Payment Page on this device</a>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="cancel-qr-btn">Cancel</button>' +
            '</div>';

        var cancelBtn = o.querySelector('#cancel-qr-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                clearInterval(qrPollTimer);
                o.className = '';
            });
        }

        // Start real-time status polling
        qrPollTimer = setInterval(function () {
            fetch('/api/payments/status/' + encodeURIComponent(orderId))
                .then(function (r) { return r.json(); })
                .then(function (st) {
                    if (st && st.status === 'Successful') {
                        clearInterval(qrPollTimer);
                        handlePaymentSuccess(o, orderId, st.transactionId, data.total, t, customer);
                    }
                })
                .catch(function () {});
        }, 1500);
    }

    function spawnConfetti(parent) {
        var wrap = document.createElement('div');
        wrap.className = 'cc-confetti-wrap';
        var colors = ['#D90019', '#F5B900', '#22c55e', '#8F1420', '#3b82f6', '#ec4899'];
        for (var i = 0; i < 40; i++) {
            var p = document.createElement('div');
            p.className = 'cc-confetti-particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            p.style.animationDelay = (Math.random() * 0.8) + 's';
            p.style.animationDuration = (1.8 + Math.random() * 1.2) + 's';
            wrap.appendChild(p);
        }
        parent.appendChild(wrap);
    }

    function handlePaymentSuccess(o, orderId, txnId, total, t, customer) {
        // Save order to localStorage
        var order = {
            id: orderId,
            placedAt: Date.now(),
            items: t.cart.map(function (c) { return { id: c.id, name: c.name, price: c.price, qty: c.qty, img: c.img }; }),
            subtotal: t.subtotal, discount: t.discount, delivery: t.delivery, total: total, coupon: t.code,
            customer: customer,
            payment: { method: 'CRAV Demo QR Payment', status: 'Paid', transactionId: txnId || 'TXN-DEMO-VERIFIED' },
            deliveryBoy: null
        };

        assignDeliveryBoy(order.id).then(function (boy) {
            order.deliveryBoy = boy;

            var token = window.CravAuth ? window.CravAuth.getToken() : null;
            var headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            fetch('/api/orders', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(order)
            }).catch(function () {});

            var orders = load(KEY_ORDERS, []);
            orders = orders.filter(function (o) { return o.id !== order.id; });
            orders.unshift(order);
            save(KEY_ORDERS, orders);
        });

        // Clear cart
        clearCart();
        var form = $('#checkout-form');
        if (form) form.setAttribute('data-done', '1');

        // Render celebratory success modal
        o.innerHTML = '<div class="cc-qr-card cc-success-card">' +
            '<div class="cc-tick" style="background:#22c55e; color:#fff; width:64px; height:64px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:32px; margin-bottom:16px;"><i class="fa-solid fa-check"></i></div>' +
            '<h3 style="color:#22c55e; font-weight:700;" class="mb-2">Demo Payment Successful!</h3>' +
            '<p class="lead mb-2">Order <b>#' + esc(orderId) + '</b> &bull; ' + money(total) + '</p>' +
            '<p class="lead mb-3" style="font-size:13px; color:#64748b;">Transaction: <code>' + esc(txnId || 'TXN-DEMO-SUCCESS') + '</code></p>' +
            '<p class="lead mb-4" style="color:#22c55e; font-weight:600;"><i class="fa-solid fa-circle-check"></i> Synchronized with mobile payment!</p>' +
            '<a href="order-tracking.html?order=' + encodeURIComponent(orderId) + '" class="cus-btn primary w-100">' + btnIcons() + 'Track Order Live</a>' +
            '</div>';

        spawnConfetti(o.querySelector('.cc-qr-card'));

        // Smooth redirect after 2.5 seconds
        setTimeout(function () {
            window.location.href = 'order-tracking.html?order=' + encodeURIComponent(orderId);
        }, 2600);
    }

    function showOverlay(kind, t, order) {
        var o = $('#cc-overlay');
        if (!o) { o = document.createElement('div'); o.id = 'cc-overlay'; document.body.appendChild(o); }
        var h = '<div class="cc-modal">';
        if (kind === 'processing') {
            h += '<div class="cc-spinner"></div><h4>Processing payment\u2026</h4><p class="lead">Please don\u2019t close or refresh this page.</p>';
        } else if (kind === 'placing') {
            h += '<div class="cc-spinner"></div><h4>Placing your order\u2026</h4>';
        } else {
            h += '<div class="cc-tick"><i class="fa-solid fa-check"></i></div>' +
                '<h4>' + (order.payment.status === 'Paid' ? 'Payment successful!' : 'Order placed!') + '</h4>' +
                '<p class="lead mb-8">Order <b>#' + esc(order.id) + '</b> \u2022 ' + money(order.total) + '</p>' +
                '<p class="lead mb-24">Your order is confirmed and a delivery partner has been assigned.</p>' +
                '<a href="order-tracking.html?order=' + encodeURIComponent(order.id) + '" class="cus-btn primary w-100">' + btnIcons() + 'Track Order</a>';
        }
        o.innerHTML = h + '</div>';
        o.className = 'show';
    }

    /* ================= delivery partner ================= */
    function getDeterministicBoy(orderId, list) {
        if (!list || !list.length) return null;
        var hash = 0;
        var str = String(orderId || 'CRAV-DEFAULT');
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        var idx = Math.abs(hash) % list.length;
        return list[idx];
    }

    function fetchBoys() {
        return fetch(DELIVERY_JSON).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (d) { return Array.isArray(d) ? d : (d.deliveryBoys || d.delivery_boys || []); });
    }
    function assignDeliveryBoy(orderId) {
        return fetchBoys().then(function (list) {
            return list.length ? getDeterministicBoy(orderId, list) : null;
        }).catch(function (e) { console.error('CRAV: could not load deliveryboy.json', e); return null; });
    }

    /* ================= order tracking ================= */
    var trackTimer;
    var searchBoyTimer1, searchBoyTimer2, searchBoyTimer3;

    window.closeMobileCallError = function () {
        var overlays = document.querySelectorAll('#cc-mobile-error-overlay, .cc-mobile-error-overlay');
        overlays.forEach(function (ov) {
            ov.classList.remove('show');
            if (ov.parentNode) ov.parentNode.removeChild(ov);
        });
    };

    function showMobileCallError(boyName) {
        window.closeMobileCallError();

        var overlay = document.createElement('div');
        overlay.id = 'cc-mobile-error-overlay';
        overlay.className = 'cc-mobile-error-overlay show';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = '<div class="cc-mobile-error-card">' +
            '<button type="button" class="cc-modal-close-x" onclick="window.closeMobileCallError(); return false;" aria-label="Close">&times;</button>' +
            '<div class="cc-mobile-error-icon"><i class="fa-solid fa-phone-slash"></i></div>' +
            '<h4>Call Failed</h4>' +
            '<p class="lead mb-16" style="font-size: 14px; color: #555;">Mobile Network Error: Cellular call forwarding unavailable. Could not connect to ' + esc(boyName || 'partner') + ' via masked VoIP relay.</p>' +
            '<div class="cc-mobile-error-details mb-20">' +
            '<div><span>Error Code:</span> <b>NET_ERR_CELLULAR_UNAVAILABLE</b></div>' +
            '<div><span>Carrier:</span> <b>VoIP Relay Timed Out (503)</b></div>' +
            '</div>' +
            '<button type="button" class="cc-mobile-error-btn" id="cc-dismiss-btn" onclick="window.closeMobileCallError(); return false;">Dismiss</button>' +
            '</div>';
        document.body.appendChild(overlay);

        if (navigator.vibrate) {
            try { navigator.vibrate([150, 70, 150]); } catch (e) {}
        }
        showToast('Mobile Error: Call could not be placed (Network Error)');

        var dismissBtn = overlay.querySelector('#cc-dismiss-btn');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                window.closeMobileCallError();
            });
            dismissBtn.addEventListener('touchend', function (e) {
                e.preventDefault();
                e.stopPropagation();
                window.closeMobileCallError();
            });
        }

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target.closest('.cc-modal-close-x') || e.target.closest('#cc-dismiss-btn') || e.target.closest('.cc-mobile-error-btn')) {
                e.preventDefault();
                e.stopPropagation();
                window.closeMobileCallError();
            }
        });
    }

    // Global keyboard and click listeners for dismissing modal
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            window.closeMobileCallError();
        }
    });

    document.addEventListener('click', function (e) {
        if (e.target.closest('#cc-dismiss-btn, .cc-mobile-error-btn, .cc-modal-close-x')) {
            e.preventDefault();
            e.stopPropagation();
            window.closeMobileCallError();
            return false;
        }

        var callBtn = e.target.closest('.cc-call-partner-btn, a[href^="tel:"]');
        if (callBtn) {
            e.preventDefault();
            e.stopPropagation();
            var orders = getOrders();
            var wanted = new URLSearchParams(location.search).get('order');
            var order = null;
            orders.forEach(function (o) { if (!order && (wanted ? o.id === wanted : true)) order = o; });
            var bName = (order && order.deliveryBoy && order.deliveryBoy.name) ? order.deliveryBoy.name : 'Delivery Partner';
            showMobileCallError(bName);
            return false;
        }
    });

    function getOrders() { var o = load(KEY_ORDERS, []); return Array.isArray(o) ? o : []; }

    function initTracking() {
        var root = $('#tracking-root');
        if (!root) return;
        var orders = getOrders();
        var wanted = new URLSearchParams(location.search).get('order');

        // If an order ID is provided, try loading from server first to ensure 100% device sync
        if (wanted) {
            fetch('/api/orders/' + encodeURIComponent(wanted))
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res && res.success && res.order) {
                        var serverOrder = res.order;
                        if (!serverOrder.deliveryBoy) {
                            assignDeliveryBoy(serverOrder.id).then(function (b) {
                                serverOrder.deliveryBoy = b;
                                syncAndPaint(serverOrder);
                            });
                        } else {
                            syncAndPaint(serverOrder);
                        }
                    } else {
                        fallbackLocalTracking();
                    }
                })
                .catch(function () {
                    fallbackLocalTracking();
                });
        } else {
            fallbackLocalTracking();
        }

        function syncAndPaint(serverOrder) {
            var found = false;
            orders = orders.map(function (o) {
                if (o.id === serverOrder.id) { found = true; return serverOrder; }
                return o;
            });
            if (!found) orders.unshift(serverOrder);
            save(KEY_ORDERS, orders);
            paintTracking(root, serverOrder, orders);
        }

        function fallbackLocalTracking() {
            var order = null;
            orders.forEach(function (o) { if (!order && (wanted ? o.id === wanted : true)) order = o; });
            if (order) {
                // Ensure order is immediately saved to server database
                fetch('/api/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(order)
                }).catch(function () {});
            } else {
                order = {
                    id: wanted || 'ORD-742918',
                    placedAt: Date.now() - 40000,
                    items: [
                        { id: 1, name: 'Zinger Burger', price: 159, qty: 2 },
                        { id: 5, name: 'Peri Peri Fries', price: 99, qty: 1 },
                        { id: 12, name: 'Cold Coffee', price: 89, qty: 1 }
                    ],
                    subtotal: 506,
                    delivery: 0,
                    coupon: 'CRAV50',
                    discount: 50,
                    total: 456,
                    payment: { method: 'UPI / Online', status: 'Paid' },
                    customer: {
                        firstName: 'Aarav',
                        lastName: 'Sharma',
                        phone: '+91 98200 55432',
                        address: 'Flat 402, Royal Residency, Linking Road',
                        state: 'Mumbai',
                        zip: '400050'
                    },
                    deliveryBoy: null
                };
                orders = [order];
                save(KEY_ORDERS, orders);
                fetch('/api/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(order)
                }).catch(function () {});
            }
            if (!order.deliveryBoy) {
                assignDeliveryBoy(order.id).then(function (boy) {
                    if (boy) { order.deliveryBoy = boy; save(KEY_ORDERS, orders.map(function (o) { return o.id === order.id ? order : o; })); }
                    paintTracking(root, order, orders);
                });
            } else paintTracking(root, order, orders);
        }

        // Live polling on tracking page to sync with admin changes
        var trackingLiveTimer = setInterval(function () {
            var currWanted = new URLSearchParams(location.search).get('order');
            if (currWanted) {
                fetch('/api/orders/' + encodeURIComponent(currWanted))
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (res && res.success && res.order) {
                            syncAndPaint(res.order);
                        }
                    })
                    .catch(function () {});
            }
        }, 3500);
    }

    function stageIndex(sec) {
        var idx = 0;
        STAGES.forEach(function (s, i) { if (sec >= s.at) idx = i; });
        return idx;
    }
    function progressPct(sec) {
        var last = STAGES.length - 1;
        if (sec >= STAGES[last].at) return 100;
        var i = stageIndex(sec), a = STAGES[i].at, b = STAGES[i + 1].at;
        return Math.min(100, ((i + (sec - a) / (b - a)) / last) * 100);
    }
    function fmtClock(s) {
        s = Math.max(0, Math.ceil(s));
        var m = Math.floor(s / 60), r = s % 60;
        return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
    }

    function paintTracking(root, order, orders) {
        var boy = order.deliveryBoy;
        var steps = STAGES.map(function (s, i) {
            return '<li class="cc-step" data-i="' + i + '"><span class="cc-dot"><i class="fa-solid ' + s.icon + '"></i></span>' +
                '<div class="cc-step-text"><h6>' + s.title + '</h6><p>' + s.text + '</p></div></li>';
        }).join('');

        var chips = orders.length > 1 ? '<div class="cc-order-chips"><span>Your orders:</span>' + orders.slice(0, 6).map(function (o) {
            return '<a href="order-tracking.html?order=' + encodeURIComponent(o.id) + '" class="' + (o.id === order.id ? 'active' : '') + '">#' + esc(o.id) + '</a>';
        }).join('') + '</div>' : '';

        var searchingHtml = '<div class="cc-card cc-boy cc-boy-searching text-center py-5">' +
            '<div class="cc-radar-pulse-wrap mb-24">' +
            '<div class="cc-pulse-ring r1"></div>' +
            '<div class="cc-pulse-ring r2"></div>' +
            '<div class="cc-pulse-ring r3"></div>' +
            '<div class="cc-radar-center-icon"><i class="fa-solid fa-person-biking"></i></div>' +
            '</div>' +
            '<h5 class="mb-8">Searching for Delivery Partner<span class="cc-dots">...</span></h5>' +
            '<p class="lead text-muted mb-16" style="font-size: 14px;">Contacting nearest delivery riders in your zone</p>' +
            '<div class="cc-search-status-bar"><div class="cc-search-progress-bar"></div></div>' +
            '<p class="cc-search-counter-text mt-12 text-muted" id="cc-search-status-msg" style="font-size: 13px;">Locating nearby partner...</p>' +
            '</div>';

        var partnerDetailsHtml = boy ? ('<div class="cc-card cc-boy cc-fade-in">' +
            '<div class="cc-partner-found-badge mb-16"><i class="fa-solid fa-circle-check"></i> Delivery Partner Assigned</div>' +
            '<h6 class="cc-card-title">YOUR DELIVERY PARTNER</h6>' +
            '<div class="cc-boy-top"><img src="' + esc(boy.image) + '" alt="' + esc(boy.name) + '"><div><h5>' + esc(boy.name) + '</h5>' +
            '<p class="cc-rating"><i class="fa-solid fa-star"></i> ' + esc(boy.rating) + ' \u2022 ' + esc(boy.deliveries) + ' deliveries</p></div></div>' +
            '<ul class="cc-boy-info unstyled">' +
            '<li><i class="fa-solid fa-motorcycle"></i><span>' + esc(boy.vehicle) + ' \u2022 ' + esc(boy.vehicle_number) + '</span></li>' +
            '<li><i class="fa-solid fa-clock"></i><span>Experience: ' + esc(boy.experience) + '</span></li>' +
            '<li><i class="fa-solid fa-user"></i><span>Speaks ' + esc((boy.languages || []).join(', ')) + '</span></li>' +
            '<li><i class="fa-solid fa-phone"></i><span>' + esc(boy.phone) + '</span></li></ul>' +
            '<button type="button" class="cus-btn dark w-100 cc-call-partner-btn">' + btnIcons() + 'Call Delivery Partner</button></div>')
            : '<div class="cc-card"><h6 class="cc-card-title">YOUR DELIVERY PARTNER</h6><p class="lead">A delivery partner will be assigned shortly.</p></div>';

        var c = order.customer || {};
        var itemsHtml = order.items.map(function (i) {
            return '<div class="d-flex justify-content-between mb-8"><p class="lead color-black">' + esc(i.name) + ' \u00D7 ' + i.qty + '</p><p class="lead">' + money(i.price * i.qty) + '</p></div>';
        }).join('');

        root.innerHTML = chips +
            '<div class="cc-track-head"><div><p class="cc-kicker">ORDER #' + esc(order.id) + '</p><h3 id="cc-status-title">\u2026</h3><p class="lead" id="cc-status-text"></p></div>' +
            '<div class="cc-eta"><span>Estimated arrival</span><b id="cc-eta">--:--</b></div></div>' +
            '<div class="cc-card cc-progress-card"><div class="cc-bar"><div class="cc-bar-fill" id="cc-bar-fill"></div></div><ol class="cc-steps unstyled">' + steps + '</ol></div>' +
            '<div class="row"><div class="col-lg-5 mb-32" id="cc-boy-col">' + searchingHtml + '</div><div class="col-lg-7 mb-32"><div class="cc-card"><h6 class="cc-card-title">ORDER DETAILS</h6>' +
            itemsHtml + '<div class="vr-line mb-16 mt-16"></div>' +
            '<div class="d-flex justify-content-between mb-8"><p class="lead">Subtotal</p><p class="lead">' + money(order.subtotal) + '</p></div>' +
            '<div class="d-flex justify-content-between mb-8"><p class="lead">Delivery</p><p class="lead">' + (order.delivery ? money(order.delivery) : 'FREE') + '</p></div>' +
            (order.discount ? '<div class="d-flex justify-content-between mb-8"><p class="lead">Coupon (' + esc(order.coupon) + ')</p><p class="lead cc-green">-' + money(order.discount) + '</p></div>' : '') +
            '<div class="d-flex justify-content-between mb-24"><h5 class="color-primary">TOTAL</h5><h5 class="color-primary">' + money(order.total) + '</h5></div>' +
            '<div class="cc-meta"><div><b>Payment</b><span>' + esc(order.payment.method) + ' \u2022 ' + esc(order.payment.status) + '</span></div>' +
            '<div><b>Deliver to</b><span>' + esc([c.firstName, c.lastName].join(' ').trim()) + ', ' + esc([c.address, c.address2, c.state, c.zip].filter(Boolean).join(', ')) + '</span></div>' +
            '<div><b>Phone</b><span>' + esc(c.phone) + '</span></div></div></div></div></div>' +
            '<a href="shop-grid.html" class="cus-btn primary">' + btnIcons() + 'Order Something Else</a>';

        clearTimeout(searchBoyTimer1);
        clearTimeout(searchBoyTimer2);
        clearTimeout(searchBoyTimer3);

        var boyCol = $('#cc-boy-col');
        var msgEl = $('#cc-search-status-msg');
        searchBoyTimer1 = setTimeout(function () {
            if (msgEl) msgEl.textContent = 'Found riders in your area, confirming pickup...';
        }, 2200);
        searchBoyTimer2 = setTimeout(function () {
            if (msgEl) msgEl.textContent = 'Partner accepting order...';
        }, 4400);
        searchBoyTimer3 = setTimeout(function () {
            if (boyCol) {
                boyCol.innerHTML = partnerDetailsHtml;
                showToast('Delivery Partner Found! ' + esc(boy ? boy.name : '') + ' has accepted your order.');
            }
        }, 6000);

        function tick() {
            var sec = (Date.now() - order.placedAt) / 1000;
            var idx = stageIndex(sec);
            $$('.cc-step', root).forEach(function (li, i) {
                li.classList.toggle('done', i < idx || (i === idx && idx === STAGES.length - 1));
                li.classList.toggle('current', i === idx && idx !== STAGES.length - 1);
            });
            $('#cc-bar-fill').style.setProperty('--p', progressPct(sec) + '%');
            $('#cc-status-title').textContent = STAGES[idx].title;
            $('#cc-status-text').textContent = STAGES[idx].text;
            var left = STAGES[STAGES.length - 1].at - sec;
            $('#cc-eta').textContent = left > 0 ? fmtClock(left) : 'Delivered';
            if (left <= 0) clearInterval(trackTimer);
        }
        tick();
        clearInterval(trackTimer);
        trackTimer = setInterval(tick, 1000);
    }

    /* ================= add-to-cart from product cards ================= */
    function readCard(btn) {
        var card = btn.closest('.item-card, .product-card, .product-list-card, .menu-card') ||
            btn.closest('[class*="card"]');
        if (!card) return null;
        var id = card.getAttribute('data-id'), name = card.getAttribute('data-name');
        var price = card.getAttribute('data-price'), img = card.getAttribute('data-img');
        if (!name) {
            var t = card.querySelector('.title, h4 a, h5 a, h6 a, h4, h5');
            name = t ? t.textContent.trim() : '';
        }
        if (!price) {
            var cands = $$('.price-cart h5, .price, h3, h4, h5, h6, p', card);
            for (var i = 0; i < cands.length; i++) {
                var m = /\u20B9\s*([\d.,]+)/.exec(cands[i].textContent);
                if (m) { price = m[1].replace(/,/g, ''); break; }
            }
        }
        if (!img) {
            var im = $$('img', card).filter(function (x) { return !/shopping-cart/.test(x.getAttribute('src') || ''); })[0];
            img = im ? im.getAttribute('src') : '';
        }
        if (!name || !num(price)) return null;
        var qtyInput = $('input.number', card);
        return { item: { id: id || slug(name), name: name, price: num(price), img: img || '' }, qty: qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1, qtyInput: qtyInput };
    }

    function openMini() {
        var body = document.body;
        if (body.classList.contains('show-sidebar-cart')) return;
        body.classList.add('show-sidebar-cart');
        var cur = $('#sidebar-cart-curtain');
        if (cur) cur.style.display = 'block';
    }

    /* ================= wishlist ================= */
    var KEY_WISHLIST = 'crav_wishlist';
    function getWishlist() { var w = load(KEY_WISHLIST, []); return Array.isArray(w) ? w : []; }
    function setWishlist(w) { save(KEY_WISHLIST, w); renderWishlistPage(); updateWishlistUI(); }
    function inWishlist(id, name) {
        return getWishlist().some(function (x) {
            return (id && String(x.id) === String(id)) || (name && x.name === name);
        });
    }

    function toggleWishlist(item) {
        if (!item || !item.name) return false;
        var list = getWishlist();
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
            if ((item.id && String(list[i].id) === String(item.id)) || list[i].name === item.name) {
                idx = i;
                break;
            }
        }
        if (idx > -1) {
            list.splice(idx, 1);
            setWishlist(list);
            toast(item.name + ' removed from Wishlist');
            return false;
        } else {
            list.push({
                id: item.id || slug(item.name),
                name: item.name,
                price: Number(item.price) || 0,
                img: item.img || '',
                desc: item.desc || 'Freshly prepared and served hot with quality ingredients.'
            });
            setWishlist(list);
            toast(item.name + ' added to Wishlist!');
            return true;
        }
    }

    function removeFromWishlist(id) {
        var list = getWishlist();
        var removed = null;
        var filtered = list.filter(function (x) {
            if (String(x.id) === String(id) || x.name === id) {
                removed = x;
                return false;
            }
            return true;
        });
        save(KEY_WISHLIST, filtered);
        renderWishlistPage();
        updateWishlistUI();
        toast((removed ? removed.name : 'Item') + ' removed from Wishlist');
    }

    function renderWishlistPage() {
        var container = $('#wishlist-container');
        if (!container) return;
        var list = getWishlist();
        if (!list || list.length === 0) {
            container.innerHTML = '<div class="col-12">' +
                '<div class="cc-empty text-center py-5">' +
                '<div class="cc-empty-icon mb-24" style="width: 80px; height: 80px; border-radius: 50%; background: #fdecea; color: #D90019; display: grid; place-items: center; font-size: 36px; margin: 0 auto 20px;">' +
                '<i class="fa-regular fa-heart"></i>' +
                '</div>' +
                '<h3 class="mb-12">Your Wishlist is Empty</h3>' +
                '<p class="lead text-muted mb-32" style="max-width: 480px; margin: 0 auto 32px;">You haven\'t saved any items yet. Explore our delicious menu and tap the heart icon on any dish to save it here!</p>' +
                '<a href="shop-grid.html" class="cus-btn primary">' + btnIcons() + 'Explore Menu</a>' +
                '</div></div>';
            return;
        }

        container.innerHTML = list.map(function (it) {
            return '<div class="item-card col-xl-3 col-lg-4 col-sm-6 mb-32" data-id="' + esc(it.id) + '" data-name="' + esc(it.name) + '" data-price="' + it.price + '" data-img="' + esc(it.img) + '">' +
                '<div class="product-card text-center" style="position: relative;">' +
                '<button type="button" class="remove-from-wishlist-btn" data-wishlist-remove="' + esc(it.id) + '" title="Remove from Wishlist"><i class="fa-light fa-xmark"></i></button>' +
                '<div class="product-img mb-16">' +
                (it.img ? '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" loading="lazy">' : '') +
                '</div>' +
                '<h5 class="title">' + esc(it.name) + '</h5>' +
                '<p class="desc">' + esc(it.desc || 'Freshly prepared and served hot with quality ingredients.') + '</p>' +
                '<div class="action-block">' +
                '<div class="quantity quantity-wrap">' +
                '<div class="decrement"><i class="fa-solid fa-dash"></i></div>' +
                '<input type="text" name="quantity" value="1" maxlength="2" size="1" class="number">' +
                '<div class="increment"><i class="fa-solid fa-plus-large"></i></div>' +
                '</div>' +
                '<div class="price-cart">' +
                '<h5>' + money(it.price) + '</h5>' +
                '<a href="javascript:;" class="cart-btn cart-button"><img src="assets/media/icons/shopping-cart.png" alt=""></a>' +
                '</div>' +
                '</div></div></div>';
        }).join('');
    }

    function ensureWishlistButtons() {
        var cards = document.querySelectorAll('.product-card, .product-card-2, .product-list-card');
        cards.forEach(function (card) {
            if (card.querySelector('.remove-from-wishlist-btn')) return;
            if (!card.querySelector('.wishlist-toggle-btn')) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'wishlist-toggle-btn';
                btn.title = 'Save to Wishlist';
                btn.setAttribute('aria-label', 'Save to Wishlist');
                btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
                card.style.position = 'relative';
                card.insertBefore(btn, card.firstChild);
            }
        });
        updateWishlistUI();
    }

    window.updateWishlistUI = function () {
        var list = getWishlist();
        var buttons = document.querySelectorAll('.wishlist-toggle-btn');
        buttons.forEach(function (btn) {
            var card = btn.closest('.item-card, .product-card, .product-card-2, .product-list-card');
            if (!card) return;
            var data = readCard(btn);
            var isSaved = false;
            if (data && data.item) {
                var it = data.item;
                isSaved = inWishlist(it.id, it.name);
            }
            btn.classList.toggle('active', isSaved);
            var icon = btn.querySelector('i');
            if (icon) {
                icon.className = isSaved ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            }
        });

        var badges = document.querySelectorAll('.cc-wishlist-badge');
        badges.forEach(function (b) {
            b.textContent = list.length;
            b.style.display = list.length > 0 ? 'inline-block' : 'none';
        });
    };

    document.addEventListener('click', function (e) {
        var wishBtn = e.target.closest('.wishlist-toggle-btn');
        if (wishBtn) {
            e.preventDefault();
            e.stopPropagation();
            var cdata = readCard(wishBtn);
            if (cdata && cdata.item) {
                toggleWishlist(cdata.item);
            }
            return;
        }

        var wishRemoveBtn = e.target.closest('.remove-from-wishlist-btn, [data-wishlist-remove]');
        if (wishRemoveBtn) {
            e.preventDefault();
            e.stopPropagation();
            var wid = wishRemoveBtn.getAttribute('data-wishlist-remove') || wishRemoveBtn.getAttribute('data-wishlist-id');
            if (!wid) {
                var pCard = wishRemoveBtn.closest('.item-card, .product-card');
                wid = pCard ? (pCard.getAttribute('data-id') || (pCard.querySelector('.title') || {}).textContent) : null;
            }
            if (wid) removeFromWishlist(wid);
            return;
        }

        var btn = e.target.closest('.cart-btn');
        if (btn) {
            var data = readCard(btn);
            if (data) {
                addItem(data.item, data.qty);
                if (data.qtyInput) data.qtyInput.value = 1;
                toast(data.item.name + ' added to cart');
                // app.js toggles the sidebar on static buttons; open it for dynamic ones
                setTimeout(openMini, 0);
            }
            return;
        }

        var a = e.target.closest('[data-cc]');
        if (!a) return;
        var act = a.getAttribute('data-cc'), id = a.getAttribute('data-id');
        if (act === 'inc' || act === 'dec') {
            var cur = getCart().filter(function (c) { return c.id === id; })[0];
            if (cur) setQty(id, cur.qty + (act === 'inc' ? 1 : -1));
        } else if (act === 'remove') { e.preventDefault(); removeItem(id); }
        else if (act === 'clear') clearCart();
        else if (act === 'remove-coupon') removeCoupon();
        else if (act === 'apply-coupon' || act === 'use-coupon') {
            var box = a.closest('.cc-coupon');
            var code = act === 'use-coupon' ? a.getAttribute('data-code') : $('.cc-coupon-input', box).value;
            var r = applyCoupon(code);
            if (!r.ok) {
                // re-query (render may not have happened)
                var msgs = $$('.cc-coupon-msg');
                msgs.forEach(function (m) { m.textContent = r.msg; m.className = 'cc-coupon-msg err'; });
            } else toast(r.msg);
        }
    }, false);

    document.addEventListener('change', function (e) {
        if (e.target.matches('input[data-cc="qty"]')) {
            setQty(e.target.getAttribute('data-id'), parseInt(e.target.value, 10) || 1);
        }
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('cc-coupon-input')) {
            e.preventDefault();
            var r = applyCoupon(e.target.value);
            if (!r.ok) { var m = $('.cc-coupon-msg', e.target.closest('.cc-coupon')); if (m) { m.textContent = r.msg; m.className = 'cc-coupon-msg err'; } }
            else toast(r.msg);
        }
    });
    window.addEventListener('storage', function (e) {
        if (e.key === KEY_CART || e.key === KEY_COUPON) renderAll();
        if (e.key === KEY_WISHLIST) { renderWishlistPage(); updateWishlistUI(); }
    });

    /* ================= render everything ================= */
    function renderAll() {
        var t = totals();
        renderBadge(t);
        renderMini(t);
        renderCartPage(t);
        renderCheckout(t);
    }

    function init() {
        prepMiniCart();
        initCheckout();
        initTracking();
        renderWishlistPage();
        ensureWishlistButtons();
        renderAll();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.CravCart = { add: addItem, get: getCart, totals: totals, applyCoupon: applyCoupon, clear: clearCart, COUPONS: COUPONS };
})();
