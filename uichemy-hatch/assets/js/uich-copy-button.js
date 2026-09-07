// Gutenberg Paste Button
(function(window, wp) {
    // White UiChemy glyph (mark only, transparent background) so it reads on the
    // orange button fill. Inlined so the button is fully self-contained.
    const glyphMark = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M14.2081 17.8755C14.2081 17.8755 9.77244 18.1264 9.77244 14.7703V6.21257C9.77244 5.39663 9.60889 4.5887 9.29109 3.83488C8.9733 3.08107 8.50748 2.39614 7.92028 1.81923C7.33308 1.24233 6.63598 0.784742 5.86878 0.472593C5.10159 0.160445 4.27932 -0.000139528 3.44896 9.09654e-08H0V17.0569C0 18.8896 0.740883 20.6471 2.05966 21.943C3.37843 23.2389 5.16707 23.9669 7.0321 23.9669H7.04182C7.51895 24.011 7.99924 24.011 8.47637 23.9669H16.8749C18.7646 23.9669 20.5769 23.2292 21.9131 21.9162C23.2493 20.6032 24 18.8224 24 16.9655V12.7217H14.2308L14.2081 17.8755ZM15.0736 13.5499H23.1497V16.9602C23.1471 18.5947 22.4852 20.1615 21.309 21.3173C20.1328 22.473 18.5383 23.1235 16.8749 23.126H12.8958C13.3198 22.792 13.691 22.3979 13.9971 21.9566C14.9405 20.5874 15.0617 19.0555 15.0617 17.8766L15.0736 13.5499Z" fill="#fff"/><path d="M19.9128 0C18.4046 -2.68126e-08 16.9581 0.58864 15.8916 1.63647C14.825 2.68429 14.2257 4.1055 14.2254 5.58749V8.93826H23.9979V0H19.9128Z" fill="#fff"/></svg>';

    // White Label: an uploaded brand logo replaces the glyph above. `wl_logo` is
    // empty (so the glyph stays) unless white-labeling is on AND a logo was set —
    // the button used to paint the UiChemy mark on every white-labelled site.
    function brandMark() {
        const logo = (window.uichemy_ajax_object && uichemy_ajax_object.wl_logo) || '';
        return logo
            ? '<img src="' + logo + '" alt="" width="20" height="20" style="display:block;object-fit:contain" />'
            : glyphMark;
    }

    function brandName() {
        return (window.uichemy_ajax_object && uichemy_ajax_object.wl_name) || 'UiChemy';
    }

    // Solid brand button: mark + "Paste" label on UiChemy orange. All styling
    // lives in assets/css/uich-cp.css (#uich-paste-clipboard).
    //
    // A getter, not a constant: wp_localize_script data is attached to the script
    // handle and is guaranteed present by the time a handler runs, but not
    // necessarily while this module body evaluates.
    function copyButtonHtml() {
        return brandMark() + '<span class="uich-pc-label">Paste</span>';
    }

    const loadingButton = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><style>.spinner_ajPY{transform-origin:center;animation:spinner_AtaB .75s infinite linear}@keyframes spinner_AtaB{100%{transform:rotate(360deg)}}</style><path fill="#FFFFFF" d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity=".25"/><path fill="#FFFFFF" d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" class="spinner_ajPY"/></svg> Uploading...';

    // Create modal HTML
    function createModal() {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'uich-clipboard-modal-overlay';
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
        `;

        const modalContent = document.createElement('div');
        modalContent.className = 'uich-clipboard-paste-data';
        modalContent.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 30px;
            max-width: 400px;
            width: 90%;
            position: relative;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        `;

        modalContent.innerHTML = `
            <button class="uich-modal-close" type="button" style="position: absolute; top: 15px; right: 15px; background: none; border: none; cursor: pointer; padding: 5px; display: flex; align-items: center; justify-content: center; transition: opacity 0.2s; z-index: 10;" title="Close">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events: none;">
                    <path d="M15 5L5 15M5 5L15 15" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            <div class="uich-clip-pop-content" style="text-align: center;">
                <svg width="84" height="85" viewBox="0 0 84 85" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom: 20px;">
                    <g clipPath="url(#clip0_4829_3031)">
                    <path d="M36.75 41.625C36.75 35.353 41.853 30.25 48.125 30.25H59.5V20.625C59.5 15.3155 55.1845 11 49.875 11H9.625C4.3155 11 0 15.3155 0 20.625V64.375C0 69.6845 4.3155 74 9.625 74H36.75V41.625Z" fill="#1E1E1E"/>
                    <path d="M37.6641 7.88199L37.9528 8.9H39.011H42.875C43.5508 8.9 44.1 9.4492 44.1 10.125V17.125C44.1 19.7293 41.9793 21.85 39.375 21.85H20.125C17.5207 21.85 15.4 19.7293 15.4 17.125V10.125C15.4 9.4492 15.9492 8.9 16.625 8.9H20.489H21.5472L21.8359 7.88199C22.8143 4.43198 25.9974 1.9 29.75 1.9C33.5026 1.9 36.6857 4.43198 37.6641 7.88199Z" fill="#1E1E1E" stroke="white" strokeWidth="2.8"/>
                    <path d="M77.875 35.5H48.125C44.744 35.5 42 38.244 42 41.625V78.375C42 81.756 44.744 84.5 48.125 84.5H77.875C81.256 84.5 84 81.756 84 78.375V41.625C84 38.244 81.256 35.5 77.875 35.5Z" fill="#A5A5A5"/>
                    <path d="M70.4375 67H54.6875C53.2385 67 52.0625 65.824 52.0625 64.375C52.0625 62.926 53.2385 61.75 54.6875 61.75H70.4375C71.8865 61.75 73.0625 62.926 73.0625 64.375C73.0625 65.824 71.8865 67 70.4375 67Z" fill="white"/>
                    <path d="M70.4375 56.5H54.6875C53.2385 56.5 52.0625 55.324 52.0625 53.875C52.0625 52.426 53.2385 51.25 54.6875 51.25H70.4375C71.8865 51.25 73.0625 52.426 73.0625 53.875C73.0625 55.324 71.8865 56.5 70.4375 56.5Z" fill="white"/>
                    </g>
                    <defs>
                    <clipPath id="clip0_4829_3031">
                    <rect width="84" height="84" fill="white" transform="translate(0 0.5)"/>
                    </clipPath>
                    </defs>
                </svg>
                <div class="uich-clip-os-wrap" style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 20px; font-size: 14px;">
                    <div class="uich-os-tag" style="display: flex; align-items: center; gap: 22px; width: max-content;">
                        <label style="font-weight: 600;">For Mac:</label>
                        <span class="os-icon" style="display: flex; align-items: center; gap: 5px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1C1C1C" rx="5"/><path fill="#fff" d="M20.8 17.6h-1.6v-3.2h1.6c1.765 0 3.2-1.436 3.2-3.2C24 9.436 22.565 8 20.8 8a3.203 3.203 0 0 0-3.2 3.2v1.6h-3.2v-1.6c0-1.764-1.435-3.2-3.2-3.2A3.203 3.203 0 0 0 8 11.2c0 1.764 1.435 3.2 3.2 3.2h1.6v3.2h-1.6A3.203 3.203 0 0 0 8 20.8c0 1.764 1.435 3.2 3.2 3.2 1.765 0 3.2-1.436 3.2-3.2v-1.6h3.2v1.6c0 1.764 1.435 3.2 3.2 3.2 1.765 0 3.2-1.436 3.2-3.2 0-1.765-1.435-3.2-3.2-3.2Zm-1.6-6.4c0-.882.718-1.6 1.6-1.6.882 0 1.6.718 1.6 1.6 0 .882-.718 1.6-1.6 1.6h-1.6v-1.6Zm-6.4 9.6c0 .882-.718 1.6-1.6 1.6-.882 0-1.6-.718-1.6-1.6 0-.882.718-1.6 1.6-1.6h1.6v1.6Zm0-8h-1.6c-.882 0-1.6-.718-1.6-1.6 0-.882.718-1.6 1.6-1.6.882 0 1.6.718 1.6 1.6v1.6Zm4.8 4.8h-3.2v-3.2h3.2v3.2Zm3.2 4.8c-.882 0-1.6-.718-1.6-1.6v-1.6h1.6c.882 0 1.6.718 1.6 1.6 0 .882-.718 1.6-1.6 1.6Z"/></svg>
                            + V
                        </span>
                    </div>
                    <div class="uich-clip-separator" style="color: #ccc;">|</div>
                    <div class="uich-os-tag" style="display: flex; align-items: center; gap: 8px; width: max-content;">
                        <label style="font-weight: 600;">For Windows:</label>
                        <span class="os-icon" style="display: flex; align-items: center; gap: 5px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1C1C1C" rx="5"/><path fill="#fff" d="M8 10.5v5h7V9.625L8 10.5ZM16 9.5v6h8v-7l-8 1ZM16 16.5v6l8 1v-7h-8ZM8 16.5v5l7 .875V16.5H8Z"/></svg>
                            + V
                        </span>
                    </div>
                </div>
                <div class='uich-head-clip-pop' style="margin-bottom: 15px; font-size: 16px; font-weight: 600; color: #333;">To paste with images from ${brandName()}</div>
                <input type="text" id="uich-paste-area-input" autocomplete="off" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; outline: none;" />
            </div>
        `;

        modalOverlay.appendChild(modalContent);
        
        // Add close button functionality with proper event handling
        setTimeout(function() {
            const closeBtn = modalContent.querySelector('.uich-modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeModal();
                });
                closeBtn.addEventListener('mouseenter', function() {
                    this.style.opacity = '0.7';
                });
                closeBtn.addEventListener('mouseleave', function() {
                    this.style.opacity = '1';
                });
            }
        }, 0);
        
        return modalOverlay;
    }

    function closeModal() {
        const modal = document.querySelector('.uich-clipboard-modal-overlay');
        if (modal) {
            modal.remove();
        }
        const clipboardBtn = document.querySelector("#uich-paste-clipboard");
        if (clipboardBtn) {
            clipboardBtn.innerHTML = copyButtonHtml();
        }
    }

    function openModal() {
        if (document.querySelector('.uich-clipboard-modal-overlay')) {
            return;
        }

        const modal = createModal();
        document.body.appendChild(modal);

        const inputArea = modal.querySelector("#uich-paste-area-input");
        inputArea.focus();

        // Close on overlay click
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        // Handle paste event
        inputArea.addEventListener("paste", async function(event) {
            event.preventDefault();
            closeModal();
            
            const pastedData = event.clipboardData.getData("text");

            if (pastedData) {
                const pattern = /<!--\s?\/?wp:[a-z-\/]+\s?.*?-->/g;
                const result = pattern.test(pastedData);
                
                if (result) {
                    const block = wp.blocks.parse(pastedData);
                    const blockStringify = JSON.stringify(block);
                    const isTPAG = block[0].name.startsWith("tpgb/");
                    const checkMedia = /\.(jpg|png|jpeg|gif|svg|avif|webp)/gi.test(blockStringify);
                    
                    const clipboardBtn = document.querySelector("#uich-paste-clipboard");
                    if (clipboardBtn) {
                        clipboardBtn.innerHTML = loadingButton;
                    }

                    if (checkMedia) {
                        jQuery.ajax({
                            url: isTPAG ? tpgb_blocks_load.ajax_url : uichemy_ajax_object.ajax_url,
                            method: "POST",
                            data: {
                                nonce: isTPAG ? tpgb_admin.tpgb_nonce : uichemy_ajax_object.nonce,
                                action: isTPAG ? "tpgb_cross_cp_import" : "uichemy_import_images",
                                content: blockStringify
                            }
                        }).done(function(e) {
                            if (e.success) {
                                if (clipboardBtn) {
                                    clipboardBtn.innerHTML = copyButtonHtml();
                                }
                                const data = e.data[0];
                                wp.data.dispatch('core/block-editor').insertBlocks(data);
                            }
                        });
                    } else {
                        if (clipboardBtn) {
                            clipboardBtn.innerHTML = copyButtonHtml();
                        }
                        wp.data.dispatch("core/block-editor").insertBlocks(block);
                    }
                }
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', function escapeHandler(e) {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escapeHandler);
            }
        });
    }

    // Subscribe to WordPress data changes
    wp.data.subscribe(function() {
        const toolbar = document.querySelector(".edit-post-header-toolbar .editor-document-tools__left");
        
        if (toolbar) {
            setTimeout(function() {
                if (!toolbar.querySelector("#uich-paste-clipboard")) {
                    const wrapper = document.createElement("div");
                    wrapper.classList.add("uich-paste-clipboard-wrap");
                    
                    const button = document.createElement("button");
                    button.id = "uich-paste-clipboard";
                    button.title = "Paste";
                    button.innerHTML = copyButtonHtml();
                    // Styling (solid orange, white glyph + label, hover) lives in
                    // assets/css/uich-cp.css so both editors stay in sync.
                    button.addEventListener("click", openModal);
                    
                    wrapper.appendChild(button);
                    toolbar.appendChild(wrapper);
                }
            }, 1);
        }
    });

})(window, wp);