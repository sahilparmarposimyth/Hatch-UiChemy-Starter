// Create modal overlay
document.addEventListener('DOMContentLoaded', () => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css?family=Plus+Jakarta+Sans";
    link.rel = "stylesheet";
    document.head.appendChild(link);

    function injectButton(toolbar) {
        if (!toolbar || toolbar.querySelector('.uichemy-upload-btn')) return;

        // White Label: an uploaded brand logo replaces the UiChemy glyph below.
        // `wl_logo` is empty unless white-labeling is on AND a logo was set, so the
        // inline glyph stays the default — this button used to paint the UiChemy
        // mark into the Elementor toolbar of every white-labelled site.
        const brandName = () => (window.uich_ajax_object_data && uich_ajax_object_data.wl_name) || 'UiChemy';
        const brandMark = (size) => {
            const logo = (window.uich_ajax_object_data && uich_ajax_object_data.wl_logo) || '';
            return logo
                ? `<img src="${logo}" alt="" width="${size}" height="${size}" style="display:block;object-fit:contain" />`
                : `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
            <path d="M14.2081 17.8755C14.2081 17.8755 9.77244 18.1264 9.77244 14.7703V6.21257C9.77244 5.39663 9.60889 4.5887 9.29109 3.83488C8.9733 3.08107 8.50748 2.39614 7.92028 1.81923C7.33308 1.24233 6.63598 0.784742 5.86878 0.472593C5.10159 0.160445 4.27932 -0.000139528 3.44896 9.09654e-08H0V17.0569C0 18.8896 0.740883 20.6471 2.05966 21.943C3.37843 23.2389 5.16707 23.9669 7.0321 23.9669H7.04182C7.51895 24.011 7.99924 24.011 8.47637 23.9669H16.8749C18.7646 23.9669 20.5769 23.2292 21.9131 21.9162C23.2493 20.6032 24 18.8224 24 16.9655V12.7217H14.2308L14.2081 17.8755ZM15.0736 13.5499H23.1497V16.9602C23.1471 18.5947 22.4852 20.1615 21.309 21.3173C20.1328 22.473 18.5383 23.1235 16.8749 23.126H12.8958C13.3198 22.792 13.691 22.3979 13.9971 21.9566C14.9405 20.5874 15.0617 19.0555 15.0617 17.8766L15.0736 13.5499Z" fill="#fff"/>
            <path d="M19.9128 0C18.4046 -2.68126e-08 16.9581 0.58864 15.8916 1.63647C14.825 2.68429 14.2257 4.1055 14.2254 5.58749V8.93826H23.9979V0H19.9128Z" fill="#fff"/>
            </svg>`;
        };


        // ---- UiChemy design-system tokens (uc-*), inlined because the DS
        //      stylesheet is not loaded inside the Elementor editor. -------
        const UC = {
            fontSans: '"Zalando Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            surfaceBase: '#F4F4F4',      // grey tray
            surfaceRaised: '#FFFFFF',    // white card
            surfaceSunken: '#EBEBEB',
            textStrong: '#0A0A0A',
            textMuted: '#737373',
            border: 'rgba(0, 0, 0, 0.09)',
            borderSubtle: 'rgba(0, 0, 0, 0.055)',
            ring: 'rgba(23, 23, 23, 0.40)',
            brand: '#FD6A35',
            brandOn: '#FFFFFF',
            radiusMd: '8px',
            radiusXl: '16px',
            shadow5: '0 0 0 1px rgba(128,128,128,0.06), 0 12px 24px -8px rgba(0,0,0,0.08), 0 28px 56px -12px rgba(0,0,0,0.14)',
            shadowControl: 'inset 0 1px 0 0 rgba(255,255,255,0.6), inset 0 0 0 1px rgba(0,0,0,0.09), 0 1px 2px rgba(0,0,0,0.06)',
            shadowControlBrand: 'inset 0 1px 0 0 rgba(255,255,255,0.24), inset 0 0 0 1px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.09), 0 2px 3px -1px rgba(0,0,0,0.06)',
            shadowInput: 'inset 0 1px 2px rgba(0,0,0,0.05), inset 0 2px 4px -2px rgba(0,0,0,0.04)',
            sheen: 'linear-gradient(to bottom, rgba(255,255,255,0.08), rgba(0,0,0,0.03))',
        };

        // Scoped placeholder color for the DS-styled textarea.
        const dsStyle = document.createElement('style');
        dsStyle.innerHTML = `
            .uich-ds-textarea::placeholder { color: ${UC.textMuted}; opacity: 1; }
            .uich-ds-textarea:focus-visible { outline: 2px solid ${UC.ring}; outline-offset: 2px; border-color: transparent; }
        `;
        document.head.appendChild(dsStyle);

        // Overlay (dark, blurred) ---------------------------------------------
        const modalOverlay = document.createElement("div");
        modalOverlay.style.display = "none";
        modalOverlay.style.position = "fixed";
        modalOverlay.style.inset = "0";
        modalOverlay.style.backgroundColor = "rgba(17, 17, 19, 0.44)";
        modalOverlay.style.backdropFilter = "blur(2px)";
        modalOverlay.style.webkitBackdropFilter = "blur(2px)";
        modalOverlay.style.zIndex = "9998";
        document.body.appendChild(modalOverlay);

        // Grey tray (positioner + content) ------------------------------------
        const modal = document.createElement("div");
        modal.style.display = "none";
        modal.style.flexDirection = "column";
        modal.style.position = "fixed";
        modal.style.top = "50%";
        modal.style.left = "50%";
        modal.style.transform = "translate(-50%, -50%)";
        modal.style.width = "min(calc(100vw - 32px), 480px)";
        modal.style.maxHeight = "calc(100vh - 48px)";
        modal.style.overflow = "visible";
        modal.style.padding = "4px";
        modal.style.gap = "4px";
        modal.style.backgroundColor = UC.surfaceBase;
        modal.style.boxShadow = UC.shadow5;
        modal.style.borderRadius = UC.radiusXl;
        modal.style.fontFamily = UC.fontSans;
        modal.style.zIndex = "9999";
        document.body.appendChild(modal);

        // Close button — sits just outside the tray's top-right corner --------
        const closeIcon = document.createElement("button");
        closeIcon.type = "button";
        closeIcon.setAttribute("aria-label", "Close");
        closeIcon.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5.63623 5.63672L18.3642 18.3646" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5.63623 18.3633L18.3642 5.63536" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        closeIcon.style.cssText = `
            position: absolute;
            top: 0;
            left: calc(100% + 8px);
            width: 32px;
            height: 32px;
            display: grid;
            place-items: center;
            border: none;
            background: ${UC.surfaceRaised};
            color: ${UC.textStrong};
            border-radius: ${UC.radiusMd};
            box-shadow: ${UC.shadowControl};
            cursor: pointer;
            transition: background 160ms cubic-bezier(0.2,0,0,1), transform 160ms cubic-bezier(0.2,0,0,1);
        `;
        closeIcon.addEventListener('mouseenter', () => { closeIcon.style.background = UC.surfaceSunken; });
        closeIcon.addEventListener('mouseleave', () => { closeIcon.style.background = UC.surfaceRaised; });
        closeIcon.addEventListener('mousedown', () => { closeIcon.style.transform = "translateY(1px)"; });
        closeIcon.addEventListener('mouseup', () => { closeIcon.style.transform = "translateY(0)"; });
        modal.appendChild(closeIcon);

        let currentAjaxCall = null;
        const timeoutIDs = [];

        const closeModal = () => {
            modal.style.display = "none";
            modalOverlay.style.display = "none";
            inputField.value = "";
            submitBtn.innerText = "Upload Images to WordPress";
            if (currentAjaxCall) currentAjaxCall.abort();
            timeoutIDs.forEach(id => clearTimeout(id));
        };
        closeIcon.addEventListener("click", closeModal);

        // White content card --------------------------------------------------
        const card = document.createElement("div");
        card.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 20px;
            background: ${UC.surfaceRaised};
            border-radius: ${UC.radiusXl};
            border: 1px solid ${UC.border};
            overflow: hidden;
        `;
        modal.appendChild(card);

        // Header: title + description (left-aligned) ---------------------------
        const header = document.createElement("div");
        header.style.cssText = "display:flex; flex-direction:column; align-items:flex-start; text-align:left; gap:4px;";

        const title = document.createElement("h2");
        title.innerText = "Upload Media & Paste";
        // DS .title: --uc-text-xl (1.25rem) / --uc-weight-semibold (folded to 500).
        title.style.cssText = `margin:0; font-family:${UC.fontSans}; font-size:1.25rem; font-weight:500; line-height:1.2; color:${UC.textStrong};`;
        header.appendChild(title);

        const desc = document.createElement("p");
        desc.innerText = "Paste your copied content below and we'll upload its images to your WordPress media library.";
        desc.style.cssText = `margin:0; font-family:${UC.fontSans}; font-size:0.875rem; line-height:1.4; color:${UC.textMuted};`;
        header.appendChild(desc);

        card.appendChild(header);

        // Body: textarea -------------------------------------------------------
        const inputField = document.createElement("textarea");
        inputField.className = "uich-ds-textarea";
        inputField.placeholder = "Paste Content Here & Click the button below";
        inputField.style.cssText = `
            width: 100%;
            height: 104px;
            box-sizing: border-box;
            border-radius: ${UC.radiusMd};
            padding: 10px 12px;
            text-align: start;
            font-family: ${UC.fontSans};
            font-size: 0.875rem;
            color: ${UC.textStrong};
            background: ${UC.surfaceRaised};
            border: 1px solid ${UC.border};
            box-shadow: ${UC.shadowInput};
            resize: none;
        `;
        card.appendChild(inputField);

        // Footer — sits on the grey tray, below the white card -----------------
        const footer = document.createElement("div");
        footer.style.cssText = "display:flex; flex-direction:column; gap:8px; padding:16px 16px 12px;";
        modal.appendChild(footer);

        // Primary CTA (brand solid) --------------------------------------------
        const submitButtonStyles = `
            width: 100%;
            box-sizing: border-box;
            background-color: ${UC.brand};
            background-image: ${UC.sheen};
            color: ${UC.brandOn};
            border: none;
            padding: 0 16px;
            min-height: 40px;
            gap: 6px;
            font-size: 0.875rem;
            font-weight: 500;
            line-height: 1;
            border-radius: ${UC.radiusMd};
            box-shadow: ${UC.shadowControlBrand};
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-image 160ms cubic-bezier(0.2,0,0,1);
            font-family: ${UC.fontSans};
        `;
        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.innerText = "Upload Images to WordPress";
        submitBtn.style.cssText = submitButtonStyles;
        submitBtn.addEventListener('mouseenter', () => {
            submitBtn.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.12), rgba(255,255,255,0.12)), ${UC.sheen}`;
        });
        submitBtn.addEventListener('mouseleave', () => {
            submitBtn.style.backgroundImage = UC.sheen;
        });
        footer.appendChild(submitBtn);

        // Copy Now button (optional, hidden) -----------------------------------
        const copyNowBtn = document.createElement("button");
        copyNowBtn.type = "button";
        copyNowBtn.innerText = "Copy Now";
        copyNowBtn.style.cssText = `
            width: 100%;
            box-sizing: border-box;
            background: ${UC.surfaceRaised};
            background-image: ${UC.sheen};
            color: ${UC.textStrong};
            border: none;
            padding: 0 16px;
            min-height: 40px;
            font-size: 0.875rem;
            font-weight: 500;
            font-family: ${UC.fontSans};
            border-radius: ${UC.radiusMd};
            box-shadow: inset 0 0 0 1px ${UC.borderSubtle}, ${UC.shadowControl};
            cursor: pointer;
            align-items: center;
            justify-content: center;
        `;
        copyNowBtn.style.display = "none";
        footer.appendChild(copyNowBtn);

        // Neutral dark-grey button — white UiChemy glyph + "Paste" label on grey.
        // Matches the Gutenberg paste button (#uich-paste-clipboard in uich-cp.css,
        // #525252 / #404040 hover); grey reads on both the dark Elementor bar and a
        // light bar. Styled inline here because that stylesheet isn't loaded in the
        // Elementor editor.
        // Matched to Elementor's own top-bar "+" (Add Element) button — a dark
        // toolbar grey, a step above the near-black bar. Tune here if the exact
        // Elementor value differs.
        const PASTE_BG = '#3a3d42';
        const PASTE_BG_HOVER = '#4a4e55';
        const buttonStyles = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            height: 34px;
            padding: 0 13px;
            margin: 5px;
            border: none;
            border-radius: 8px;
            background-color: ${PASTE_BG};
            color: ${UC.brandOn};
            font-family: ${UC.fontSans};
            font-size: 13px;
            font-weight: 500;
            line-height: 1;
            cursor: pointer;
            transition: background-color 0.2s;
        `;
        const openModalBtn = document.createElement("button");
        openModalBtn.className = 'uichemy-upload-btn';
        openModalBtn.type = "button";
        openModalBtn.style.cssText = buttonStyles;
        openModalBtn.innerHTML = `
            ${brandMark(15)}
            <span>Paste</span>
        `;
        openModalBtn.addEventListener('mouseenter', () => {
            openModalBtn.style.backgroundColor = PASTE_BG_HOVER;
        });
        openModalBtn.addEventListener('mouseleave', () => {
            openModalBtn.style.backgroundColor = PASTE_BG;
        });
        const div = document.createElement("div");
        div.className = 'preview-dimension';
        div.style.cssText = "align-self: center";
        div.setAttribute('data-balloon', 'Upload Media & Paste Using ' + brandName());
        div.setAttribute('data-balloon-pos','bottom');
        div.appendChild(openModalBtn);
        toolbar.appendChild(div);

        // Open modal on button click
        openModalBtn.addEventListener("click", () => {
            modal.style.display = "flex";
            modalOverlay.style.display = "block";
            inputField.value = "";
        });
        // Close modal when overlay is clicked
        modalOverlay.addEventListener("click", closeModal);

        // Submit data with AJAX on button click
        submitBtn.addEventListener("click", () => {
            const inputData = inputField.value;
            if (inputData) {
                submitBtn.innerText = "Uploading Media...";
                currentAjaxCall = jQuery.ajax({
                    url: uich_ajax_object_data.ajax_url,
                    method: "POST",
                    data: {
                        nonce: uich_ajax_object_data.nonce,
                        action: "elementor_import_media",
                        inputData: inputData
                    },
                })
                .done(function(response) {
                    if (response.success) {
                        const contentToCopy = response.data;
                        if (contentToCopy) {
                            const formattedContent = JSON.stringify(contentToCopy, null, 2);
                            inputField.innerText = formattedContent;
                            submitBtn.innerText = "Media Uploaded, Copying to Clipboard..";
                            submitBtn.setAttribute("data-clipboard-text", formattedContent);
                            navigator.clipboard.writeText(formattedContent)
                                .then(() => {
                                    const t1 = setTimeout(() => {
                                        submitBtn.innerText = "Copied Updated Content To Your Clipboard!";
                                        const t2 = setTimeout(() => {
                                            submitBtn.innerHTML = "You can paste it with <b> CTRL/CMD + V </b> now";
                                            const t3 = setTimeout(() => {
                                                submitBtn.innerText = "Upload Images to WordPress";
                                            }, 45000);
                                            timeoutIDs.push(t3);
                                        }, 4000);
                                        timeoutIDs.push(t2);
                                    }, 2000);
                                    timeoutIDs.push(t1);
                                })
                                .catch((err) => {
                                    submitBtn.innerText = "Failed while copying to your Clipboard";
                                });
                        }
                    } else {
                        submitBtn.innerText = "Failed to import media";
                    }
                })
                .fail(function(jqXHR, textStatus, errorThrown) {
                        submitBtn.innerText = "Failed to import media";
                });
            }
        });
    }

    // Use MutationObserver to wait for the element
    const observer = new MutationObserver(() => {
        const toolbar = document.querySelector('.MuiGrid-root.MuiGrid-container');
        if (toolbar) {
            injectButton(toolbar);
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
});