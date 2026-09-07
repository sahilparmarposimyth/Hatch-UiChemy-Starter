/**
 * uich-uichemy-dd-picker.js — the visual dynamic-data UI (vanilla, no build step).
 *
 * Three builders that let a non-technical user produce Twig by clicking:
 *   UichDD.ui.openValue(opts)     — source -> field -> (chain) -> filters -> fallback
 *   UichDD.ui.openLoop(opts)      — visual {% for %} query builder
 *   UichDD.ui.openCondition(opts) — visual {% if %} rule builder
 *
 * opts: { context: ['post','site','user','request'], onInsert: fn(twig) }
 * Each builder shows a LIVE Twig preview and an Insert button. The structured config is the
 * source of truth; we compile to Twig via UichDD.compile. Depends on uich-dd-schema.js +
 * uich-dd-compile.js (loaded first).
 */
(function () {
	"use strict";
	if (typeof window === "undefined") {
		return;
	}
	var S = window.UichDD && window.UichDD.schema;
	var C = window.UichDD && window.UichDD.compile;
	if (!S || !C) {
		return;
	}

	/* --------------------------- tiny DOM helper --------------------------- */
	function el(tag, attrs, kids) {
		var n = document.createElement(tag);
		attrs = attrs || {};
		Object.keys(attrs).forEach(function (k) {
			if (k === "class") {
				n.className = attrs[k];
			} else if (k === "text") {
				n.textContent = attrs[k];
			} else if (k === "html") {
				n.innerHTML = attrs[k];
			} else if (k.slice(0, 2) === "on") {
				n.addEventListener(k.slice(2), attrs[k]);
			} else {
				n.setAttribute(k, attrs[k]);
			}
		});
		(kids || []).forEach(function (c) {
			if (c) {
				n.appendChild(c);
			}
		});
		return n;
	}
	function select(options, value, onChange) {
		var s = el("select", {
			class: "uich-dd-select",
			onchange: function () {
				onChange(s.value);
			},
		});
		options.forEach(function (o) {
			var opt = el("option", { value: o.value, text: o.label });
			if (o.value === value) {
				opt.selected = true;
			}
			s.appendChild(opt);
		});
		return s;
	}
	function field(label, control) {
		return el("label", { class: "uich-dd-field" }, [el("span", { text: label }), control]);
	}

	/* ----------------------------- modal shell ----------------------------- */
	// `anchor` (optional) = a viewport rect { top,left,right,bottom,width,height }
	// of the trigger button. When provided the shell renders as a DROPDOWN pinned
	// under (or above) that trigger instead of a centred, backdrop-dimmed modal.
	function modal(title, buildBody, getTwig, onInsert, anchor) {
		var overlay = el("div", { class: "uich-dd-overlay" + (anchor ? " uich-dd-anchored" : "") });
		var preview = el("code", { class: "uich-dd-preview", text: "" });
		var body = el("div", { class: "uich-dd-body" });

		function refresh() {
			preview.textContent = getTwig() || "—";
		}

		function close() {
			if (overlay.parentNode) {
				overlay.parentNode.removeChild(overlay);
			}
			if (anchor) {
				window.removeEventListener("scroll", place, true);
				window.removeEventListener("resize", place);
				document.removeEventListener("keydown", onKey);
			}
		}
		function onKey(e) {
			if (e.key === "Escape") {
				close();
			}
		}

		// Insert the current expression and close. Exposed to builders so a plain
		// field can be applied by clicking it, with no trip to the Insert button —
		// see openValue(). The button remains for everything that still needs
		// confirming (typed args, filters, and the Loop/Condition/Form builders,
		// which have no field list to click).
		function commit() {
			var t = getTwig();
			if (t) {
				onInsert(t);
			}
			close();
		}

		var insertBtn = el("button", { class: "uich-dd-insert", text: "Insert", onclick: commit });
		var foot = el("div", { class: "uich-dd-foot" }, [
			el("div", { class: "uich-dd-preview-wrap" }, [el("span", { text: "Output:" }), preview]),
			insertBtn,
		]);

		/** Builders that apply on click hide the footer until something needs confirming. */
		function setFootVisible(on) {
			foot.style.display = on ? "" : "none";
		}

		/**
		 * Drop the Insert button while keeping the Output preview.
		 *
		 * The value picker opts out: every selection there applies immediately, and
		 * the few fields that need something typed first commit on Enter, so a
		 * separate confirm button was one click nobody needed. The Loop, Condition,
		 * Form and Breadcrumbs builders keep it — they have no field list to click,
		 * so the button IS their only way to confirm.
		 */
		function setInsertVisible(on) {
			insertBtn.style.display = on ? "" : "none";
		}

		var box = el("div", { class: "uich-dd-modal" }, [
			el("div", { class: "uich-dd-head" }, [el("strong", { text: title }), el("button", { class: "uich-dd-x", text: "✕", onclick: close })]),
			body,
			foot,
		]);

		// Drop the popover under the trigger; flip above when it would overflow the
		// viewport bottom, and right-align it to the trigger so it hugs the panel.
		function place() {
			if (!anchor) {
				return;
			}
			var vw = window.innerWidth,
				vh = window.innerHeight;
			var width = Math.min(340, vw - 16);
			box.style.width = width + "px";
			var bh = box.offsetHeight || 360;
			var left = anchor.right - width;
			if (left + width > vw - 8) {
				left = vw - width - 8;
			}
			if (left < 8) {
				left = 8;
			}
			var top = anchor.bottom + 6;
			if (top + bh > vh - 8) {
				var above = anchor.top - 6 - bh;
				top = above >= 8 ? above : Math.max(8, vh - bh - 8);
			}
			box.style.left = left + "px";
			box.style.top = top + "px";
		}

		overlay.addEventListener("click", function (e) {
			if (e.target === overlay) {
				close();
			}
		});

		overlay.appendChild(box);
		// Mount inside the composer's scoped shadcn host (`.uich-portal-root`,
		// which carries `.uich-tw` + the `dark`/`skin-elementor` modifier
		// classes) so the picker resolves the shadcn design tokens and follows
		// the active theme/skin. Fall back to <body> — scoping the overlay
		// itself and mirroring the theme/skin off the composer's data-attrs — on
		// the rare chance the host isn't mounted yet.
		var mount = document.querySelector(".uich-portal-root") || document.body;
		mount.appendChild(overlay);
		if (!overlay.closest(".uich-tw")) {
			overlay.classList.add("uich-tw");
			var themeEl = document.querySelector("[data-uich-composer-theme]") || document.body;
			if (themeEl.getAttribute("data-uich-composer-theme") === "dark") {
				overlay.classList.add("dark");
			}
			if (document.body.getAttribute("data-uich-composer-skin") === "elementor") {
				overlay.classList.add("skin-elementor");
			}
		}
		// commit + setFootVisible are extra args; builders that ignore them keep the
		// footer visible and the Insert button as their only confirm.
		buildBody(body, refresh, commit, setFootVisible, setInsertVisible);
		refresh();

		if (anchor) {
			place();
			// Reposition on any ancestor scroll (capture) + viewport resize so the
			// dropdown tracks its trigger; Esc closes it like a normal menu.
			window.addEventListener("scroll", place, true);
			window.addEventListener("resize", place);
			document.addEventListener("keydown", onKey);
		}
		return { close: close, refresh: refresh, reposition: place };
	}

	/* ----------------------------- value builder --------------------------- */
	function openValue(opts) {
		opts = opts || {};
		var ctx = opts.context || ["post", "site", "user", "request"];
		// Loop context: when the edited element sits inside a {% for alias in get_*() %}
		// loop, bindings must target the loop item (item.title) rather than the global
		// post (post.title). loopSource is the provider the item exposes (post/product/…).
		var loopAlias = opts.loopAlias || "";
		var loopSource = opts.loopSource || "";
		var startSource = loopSource && ctx.indexOf(loopSource) !== -1 ? loopSource : ctx[0];
		var state = { source: startSource, steps: [], filters: [], fallback: "" };

		// Re-opening the picker on a field that's already bound (e.g. {{ post.title|capitalize }})
		// should highlight the current selection instead of starting from an empty root list.
		// C.parseBinding is the same round-trip parser the codebase already ships for chips.
		if (opts.currentValue && C && typeof C.parseBinding === "function") {
			var parsed = C.parseBinding(opts.currentValue);
			if (parsed && !parsed.raw && parsed.source && ctx.indexOf(parsed.source) !== -1) {
				state.source = parsed.source;
				state.steps = (parsed.steps || []).map(function (s) {
					return { field: s.field, args: s.args || [], metaKey: s.metaKey };
				});
				state.filters = parsed.filters || [];
				state.fallback = parsed.fallback || "";
			}
		}

		function buildBinding() {
			var steps = state.steps
				.filter(function (s) {
					return s.field;
				})
				.map(function (s) {
					return { field: s.field, args: s.args || [], metaKey: s.metaKey };
				});
			return { source: state.source, steps: steps, filters: state.filters, fallback: state.fallback };
		}
		function getTwig() {
			var t = C.compileBinding(buildBinding());
			// Retarget the loop-item root: {{ post.title }} → {{ item.title }}. Only when
			// the picked root IS the loop item type; a genuinely global root (site/request)
			// the user picked on purpose is left alone.
			if (loopAlias && loopSource && state.source === loopSource) {
				t = t.replace(new RegExp("(\\{\\{\\s*)" + loopSource + "(?=$|[.\\s|()}])"), "$1" + loopAlias);
			}
			return t;
		}

		// Resolve the provider available at chain depth i (0 = root source).
		function providerAt(depth) {
			if (depth === 0) {
				return state.source;
			}
			var prev = state.steps[depth - 1];
			if (!prev || !prev.field) {
				return null;
			}
			var f = S.getFields(providerAt(depth - 1)).filter(function (x) {
				return x.key === prev.field;
			})[0];
			return f && f.provider ? f.provider : null;
		}

		modal(
			"Insert dynamic value",
			function (body, refresh, commit, setFootVisible, setInsertVisible) {
				var search = "";

				// This picker never shows an Insert button — see setInsertVisible().
				setInsertVisible(false);

				/** Enter confirms a value the user had to type. */
				function commitOnEnter(e) {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				}

				/**
				 * A field is "ready" when picking it already yields valid Twig: it is a
				 * leaf (no chain to drill into) and every argument has a usable default.
				 * Those apply on click. Anything needing typed input — Custom field's key,
				 * an Option name — keeps the Insert button so the value can be filled in
				 * first. Filters and "If empty" also live behind that button, so they stay
				 * available on the fields that show it.
				 */
				function isReadyToInsert(f) {
					if (!f || f.provider) { return false; }
					return (f.args || []).every(function (a) {
						return a && String(a.default || "") !== "";
					});
				}

				// Provider label, honouring the loop-item relabel.
				function provLabel(key) {
					if (loopAlias && loopSource && key === loopSource) {
						return "Loop item (" + loopAlias + ")";
					}
					return S.PROVIDERS[key] ? S.PROVIDERS[key].label : key;
				}
				function fieldDef(prov, key) {
					return (
						S.getFields(prov).filter(function (f) {
							return f.key === key;
						})[0] || null
					);
				}
				function matches(f) {
					if (!search) {
						return true;
					}
					return (f.label + " " + f.key).toLowerCase().indexOf(search.toLowerCase()) !== -1;
				}

				// One clickable field row. Chainable fields show a ›, leaves show their type.
				// `pro` = needs Pro in this build: the row stays visible (a hidden tag
				// sells nothing) but shows a PRO pill and opens the pricing page instead
				// of inserting a binding that would render empty.
				function fieldRow(f, onClick, active, pro) {
					return el(
						"button",
						{
							class: "uich-dd-row" + (f.provider ? " is-chain" : "") + (active ? " is-active" : "") + (pro ? " is-pro" : ""),
							type: "button",
							title: pro ? f.label + " — UiChemy Pro" : "",
							onclick: pro
								? function () {
										window.open(S.proUrl(), "_blank", "noopener");
									}
								: onClick,
						},
						[
							el("span", { class: "uich-dd-row-label", text: f.label }),
							pro
								? el("span", { class: "uich-dd-pro", text: "PRO" })
								: el("span", { class: "uich-dd-row-meta", text: f.provider ? "›" : f.type || "" }),
						],
					);
				}

				// Pick a field at chain depth `depth` for root source `source`.
				function pick(source, depth, f) {
					var prev = state.steps[depth];
					var alreadySelected = state.source === source && prev && prev.field === f.key;
					state.source = source;
					state.steps = state.steps.slice(0, depth);
					state.steps.push({
						field: f.key,
						args: (f.args || []).map(function (a) {
							return a.default || "";
						}),
						metaKey: f.metaKey,
					});
					state.filters = [];

					// Plain field: clicking it IS the insert. No second trip to a button.
					if (isReadyToInsert(f)) {
						refresh();
						commit();
						return;
					}

					// Re-clicking the field already selected confirms it — the second
					// route to inserting a field that needed typed input, alongside
					// Enter, now that there is no Insert button to press.
					if (alreadySelected) {
						refresh();
						commit();
						return;
					}

					render();
					refresh();
				}

				function render() {
					body.innerHTML = "";

					// The footer (Output + Insert) is only meaningful once something is
					// selected that could not be applied on click — a field awaiting typed
					// input, or one being refined with filters / a fallback. While browsing
					// the list there is nothing to confirm, so it stays hidden.
					setFootVisible(state.steps.length > 0);

					// Search box.
					body.appendChild(
						el("input", {
							class: "uich-dd-search",
							type: "search",
							placeholder: "Search fields…",
							value: search,
							oninput: function (e) {
								search = e.target.value;
								renderList();
							},
						}),
					);

					var list = el("div", { class: "uich-dd-list" });
					var opts2 = el("div", { class: "uich-dd-opts" });
					body.appendChild(list);
					body.appendChild(opts2);

					function group(label, prov, onPick, activeKey) {
						var fields = S.getFields(prov).filter(matches);
						if (!fields.length) {
							return;
						}
						list.appendChild(el("div", { class: "uich-dd-group", text: label }));
						fields.forEach(function (f) {
							list.appendChild(
								fieldRow(
									f,
									function () {
										onPick(f);
									},
									activeKey === f.key,
									// Introspected custom fields (f.metaKey) are the Post Custom
									// Field tag, which is Pro — S.fieldIsPro already refuses any
									// key outside the free list, and those carry a metaKey.
									S.fieldIsPro(prov, f.key),
								),
							);
						});
					}

					function breadcrumb() {
						var bc = el("div", { class: "uich-dd-crumbs" });
						bc.appendChild(
							el("button", {
								class: "uich-dd-crumb",
								type: "button",
								text: "‹ " + provLabel(state.source),
								onclick: function () {
									state.source = startSource;
									state.steps = [];
									state.filters = [];
									search = "";
									render();
									refresh();
								},
							}),
						);
						state.steps.forEach(function (s, i) {
							var fd = fieldDef(providerAt(i), s.field);
							bc.appendChild(el("span", { class: "uich-dd-crumb-sep", text: "›" }));
							bc.appendChild(
								el("button", {
									class: "uich-dd-crumb",
									type: "button",
									text: fd ? fd.label : s.field,
									onclick: function () {
										state.steps = state.steps.slice(0, i + 1);
										state.filters = [];
										render();
										refresh();
									},
								}),
							);
						});
						list.appendChild(bc);
					}

					function renderList() {
						list.innerHTML = "";
						if (state.steps.length === 0) {
							// Root: a group per source (This Post / Loop item / Site / User …).
							ctx.forEach(function (k) {
								if (!S.PROVIDERS[k]) {
									return;
								}
								group(provLabel(k), k, function (f) {
									pick(k, 0, f);
								});
							});
							// Breadcrumbs — not a provider field, so it isn't in the source
							// groups above. Surface it here as a "Navigation" entry that opens
							// its own options builder and inserts {{ breadcrumbs_html() }}
							// through this picker's same insert target.
							if (matches({ label: "Breadcrumbs", key: "breadcrumbs" })) {
								// Pro, like its Elementor tag (Uich_DT_Breadcrumbs, unregistered
								// in Free) and like breadcrumbs_html() in the engine.
								var bcPro = !S.isPro();
								list.appendChild(el("div", { class: "uich-dd-group", text: "Navigation" }));
								list.appendChild(
									el(
										"button",
										{
											class: "uich-dd-row is-chain" + (bcPro ? " is-pro" : ""),
											title: bcPro ? "Breadcrumbs — UiChemy Pro" : "",
											type: "button",
											onclick: function () {
												if (bcPro) {
													window.open(S.proUrl(), "_blank", "noopener");
													return;
												}
												var ov = body.closest(".uich-dd-overlay");
												if (ov && ov.parentNode) {
													ov.parentNode.removeChild(ov);
												}
												openBreadcrumbs({ onInsert: opts.onInsert || noop, anchor: opts.anchor });
											},
										},
										[
											el("span", { class: "uich-dd-row-label", text: "Breadcrumbs" }),
											bcPro ? el("span", { class: "uich-dd-pro", text: "PRO" }) : el("span", { class: "uich-dd-row-meta", text: "›" }),
										],
									),
								);
							}
						} else {
							breadcrumb();
							var d = state.steps.length - 1;
							var last = state.steps[d];
							var contProv = providerAt(d);
							var lastF = fieldDef(contProv, last.field);
							if (lastF && lastF.provider) {
								// Chainable: list the next provider's fields to drill into.
								group(provLabel(lastF.provider), lastF.provider, function (f) {
									pick(state.source, state.steps.length, f);
								});
							} else {
								// Leaf: show its siblings so the choice is easy to change.
								group(
									provLabel(contProv),
									contProv,
									function (f) {
										pick(state.source, d, f);
									},
									last.field,
								);
							}
						}
						renderOpts();
					}

					function renderOpts() {
						opts2.innerHTML = "";
						if (!state.steps.length) {
							return;
						}
						var d = state.steps.length - 1;
						var last = state.steps[d];
						var lastF = fieldDef(providerAt(d), last.field);
						if (!lastF || lastF.provider) {
							return;
						} // only configure a leaf

						// Field args (date format, meta key, image size…).
						if (lastF.args) {
							lastF.args.forEach(function (a, ai) {
								if (!last.args) {
									last.args = [];
								}
								if (last.args[ai] === undefined) {
									last.args[ai] = a.default || "";
								}
								opts2.appendChild(
									field(
										a.label,
										el("input", {
											class: "uich-dd-input",
											value: last.args[ai],
											oninput: function (e) {
												last.args[ai] = e.target.value;
												refresh();
											},
											onkeydown: commitOnEnter,
										}),
									),
								);
							});
						}

						// Filters.
						var avail = S.filtersForType(lastF.type);
						var filterRow = el("div", { class: "uich-dd-filters" });
						state.filters.forEach(function (fl, fi) {
							filterRow.appendChild(
								el("span", { class: "uich-dd-chip" }, [
									el("span", { text: fl.name + (fl.args && fl.args.length ? "(" + fl.args.join(",") + ")" : "") }),
									el("button", {
										class: "uich-dd-chip-x",
										text: "×",
										onclick: function () {
											state.filters.splice(fi, 1);
											renderOpts();
											refresh();
										},
									}),
								]),
							);
						});
						filterRow.appendChild(
							select(
								[{ value: "", label: "+ add filter" }].concat(
									avail.map(function (f) {
										return { value: f.name, label: f.label };
									}),
								),
								"",
								function (v) {
									if (!v) {
										return;
									}
									var def = avail.filter(function (f) {
										return f.name === v;
									})[0];
									var args =
										def && def.args
											? def.args.map(function (a) {
													return a.default || "";
												})
											: [];
									state.filters.push({ name: v, args: args });
									renderOpts();
									refresh();
								},
							),
						);
						opts2.appendChild(field("Filters", filterRow));

						// Fallback.
						opts2.appendChild(
							field(
								"If empty, show",
								el("input", {
									class: "uich-dd-input",
									value: state.fallback,
									placeholder: "(optional)",
									oninput: function (e) {
										state.fallback = e.target.value;
										refresh();
									},
									onkeydown: commitOnEnter,
								}),
							),
						);
					}

					renderList();
				}
				render();
			},
			getTwig,
			opts.onInsert || noop,
			opts.anchor,
		);
	}

	/* ------------------------------ loop builder --------------------------- */
	// opts.part: 'open' inserts only `{% for … %}` (paired with a separate Loop end);
	// 'full' (default) inserts the whole `{% for … %}…{% endfor %}` skeleton.
	function openLoop(opts) {
		opts = opts || {};
		var part = opts.part || "full";
		var src = S.LOOP_SOURCES[0];
		var state = { sourceKey: src.key, alias: src.alias, perPage: 9, orderby: "date", order: "DESC", term: "", postType: "post", taxonomy: src.taxonomy };

		function getTwig() {
			var c = C.compileLoop(state);
			return part === "open" ? c.open : c.full;
		}

		modal(
			part === "open" ? "Insert loop start" : "Insert loop",
			function (body, refresh) {
				function render() {
					body.innerHTML = "";
					body.appendChild(
						field(
							"Show",
							select(
								// Free loops over Posts only. Pro sources stay listed (marked
								// "· Pro") but picking one bounces to pricing and keeps the
								// current source — the server would return no items anyway.
								S.LOOP_SOURCES.map(function (s) {
									return { value: s.key, label: s.label + (S.loopSourceIsPro(s.key) ? " · Pro" : "") };
								}),
								state.sourceKey,
								function (v) {
									if (S.loopSourceIsPro(v)) {
										window.open(S.proUrl(), "_blank", "noopener");
										render();
										return;
									}
									state.sourceKey = v;
									var s = S.LOOP_SOURCES.filter(function (x) {
										return x.key === v;
									})[0];
									state.alias = s.alias;
									state.taxonomy = s.taxonomy || "category";
									render();
									refresh();
								},
							),
						),
					);
					body.appendChild(
						field(
							"Variable name",
							el("input", {
								class: "uich-dd-input",
								value: state.alias,
								oninput: function (e) {
									state.alias = e.target.value;
									refresh();
								},
							}),
						),
					);
					body.appendChild(
						field(
							"How many",
							el("input", {
								class: "uich-dd-input",
								type: "number",
								value: state.perPage,
								oninput: function (e) {
									state.perPage = e.target.value;
									refresh();
								},
							}),
						),
					);
					if (state.sourceKey === "get_posts") {
						body.appendChild(
							field(
								"Post type",
								el("input", {
									class: "uich-dd-input",
									value: state.postType,
									oninput: function (e) {
										state.postType = e.target.value;
										refresh();
									},
								}),
							),
						);
					}
					if (state.sourceKey === "get_posts" || state.sourceKey === "get_products" || state.sourceKey === "get_terms") {
						body.appendChild(
							field(
								"Category slug",
								el("input", {
									class: "uich-dd-input",
									value: state.term,
									placeholder: "(optional)",
									oninput: function (e) {
										state.term = e.target.value;
										refresh();
									},
								}),
							),
						);
					}
					body.appendChild(
						field(
							"Order by",
							select(
								S.ORDERBY.map(function (o) {
									return { value: o, label: o };
								}),
								state.orderby,
								function (v) {
									state.orderby = v;
									refresh();
								},
							),
						),
					);
					body.appendChild(
						field(
							"Order",
							select(
								[
									{ value: "DESC", label: "Newest / Z-A" },
									{ value: "ASC", label: "Oldest / A-Z" },
								],
								state.order,
								function (v) {
									state.order = v;
									refresh();
								},
							),
						),
					);
				}
				render();
			},
			getTwig,
			opts.onInsert || noop,
		);
	}

	/* --------------------------- condition builder ------------------------- */
	function openCondition(opts) {
		opts = opts || {};
		var part = opts.part || "full";
		var ctx = opts.context || ["post", "site", "user", "request"];
		var state = { source: ctx[0], field: "", op: "==", value: "" };

		function exprStr() {
			if (!state.field) {
				return state.source;
			}
			return state.source + "." + state.field;
		}
		function getTwig() {
			var c = C.compileCondition({ expr: exprStr(), op: state.op, value: state.value });
			return part === "open" ? c.open : c.full;
		}

		modal(
			part === "open" ? "Insert condition start" : "Insert condition",
			function (body, refresh) {
				function render() {
					body.innerHTML = "";
					body.appendChild(
						field(
							"Source",
							select(
								// A <select> has no room for a PRO pill, and a condition on a
								// Pro field would silently read null in Free — so here the
								// Pro sources/fields are filtered out rather than badged.
								ctx.filter(function (k) {
										return !S.sourceIsPro(k);
									}).map(function (k) {
									return { value: k, label: S.PROVIDERS[k] ? S.PROVIDERS[k].label : k };
								}),
								state.source,
								function (v) {
									state.source = v;
									state.field = "";
									render();
									refresh();
								},
							),
						),
					);
					body.appendChild(
						field(
							"Field",
							select(
								[{ value: "", label: "— choose —" }].concat(
									S.getFields(state.source).filter(function (f) {
											return !S.fieldIsPro(state.source, f.key);
										}).map(function (f) {
										return { value: f.key, label: f.label };
									}),
								),
								state.field,
								function (v) {
									state.field = v;
									refresh();
								},
							),
						),
					);
					body.appendChild(
						field(
							"Condition",
							select(
								S.CONDITION_OPS.map(function (o) {
									return { value: o.key, label: o.label };
								}),
								state.op,
								function (v) {
									state.op = v;
									render();
									refresh();
								},
							),
						),
					);
					if (state.op !== "is_set" && state.op !== "is_empty") {
						body.appendChild(
							field(
								"Value",
								el("input", {
									class: "uich-dd-input",
									value: state.value,
									oninput: function (e) {
										state.value = e.target.value;
										refresh();
									},
								}),
							),
						);
					}
				}
				render();
			},
			getTwig,
			opts.onInsert || noop,
		);
	}

	/* ------------------------------ form builder --------------------------- */
	// 'form-start' inserts <form data-atom-form="name"> (fields go between start and end,
	// submissions land in wp-admin → Atom Forms). 'form-end' inserts </form> + submit button.
	function openForm(opts) {
		opts = opts || {};
		var state = { name: "contact", submit: "Send" };
		function getTwig() {
			return '<form data-atom-form="' + (state.name || "form").replace(/[^a-z0-9_-]/gi, "") + '">';
		}
		modal(
			"Insert form start",
			function (body, refresh) {
				body.appendChild(
					field(
						"Form name",
						el("input", {
							class: "uich-dd-input",
							value: state.name,
							oninput: function (e) {
								state.name = e.target.value;
								refresh();
							},
						}),
					),
				);
				body.appendChild(el("div", { class: "uich-dd-field" }, [el("span", { text: "Next" }), el("div", { class: "uich-dd-hint", text: "Add your <input>/<textarea> fields, then insert “Form end”. Submissions appear in wp-admin → Form Submissions." })]));
			},
			getTwig,
			opts.onInsert || noop,
		);
	}

	function noop() {}

	/* --------------------------- breadcrumbs builder ----------------------- */
	// No-code breadcrumbs: pick the options, see the live token, insert
	// `{{ breadcrumbs_html({...})|raw }}`. Backed by the breadcrumbs_html() Twig
	// function (context-aware trail + optional schema.org). Non-default options
	// only are written, so the inserted token stays clean.
	function openBreadcrumbs(opts) {
		opts = opts || {};
		var state = {
			home_label: "Home",
			sep: "/",
			taxonomy: "",
			prefix: "",
			truncate: 0,
			show_current: true,
			schema: true,
		};
		function q(s) {
			return String(s).replace(/'/g, "\\'");
		}
		function getTwig() {
			var a = [];
			if (state.home_label !== "Home") { a.push("home_label: '" + q(state.home_label) + "'"); }
			if (state.sep !== "/") { a.push("sep: '" + q(state.sep) + "'"); }
			if (state.taxonomy) { a.push("taxonomy: '" + q(state.taxonomy) + "'"); }
			if (state.prefix) { a.push("prefix: '" + q(state.prefix) + "'"); }
			if (state.truncate > 0) { a.push("truncate: " + state.truncate); }
			if (!state.show_current) { a.push("show_current: false"); }
			if (!state.schema) { a.push("schema: false"); }
			var args = a.length ? "{ " + a.join(", ") + " }" : "";
			return "{{ breadcrumbs_html(" + args + ")|raw }}";
		}
		modal(
			"Breadcrumbs",
			function (body, refresh) {
				function textIn(key, ph) {
					return el("input", {
						class: "uich-dd-input",
						type: "text",
						value: state[key] || "",
						placeholder: ph || "",
						oninput: function (e) { state[key] = e.target.value; refresh(); },
					});
				}
				function checkIn(key) {
					var c = el("input", { type: "checkbox" });
					c.checked = !!state[key];
					c.addEventListener("change", function () { state[key] = c.checked; refresh(); });
					return c;
				}
				body.appendChild(field("Home label", textIn("home_label", "Home")));
				body.appendChild(
					field(
						"Separator",
						select(
							[
								{ value: "/", label: "/  (slash)" },
								{ value: "›", label: "›  (chevron)" },
								{ value: "»", label: "»  (angle)" },
								{ value: "•", label: "•  (dot)" },
								{ value: "-", label: "-  (dash)" },
							],
							state.sep,
							function (v) { state.sep = v; refresh(); },
						),
					),
				);
				body.appendChild(field("Post taxonomy", textIn("taxonomy", "category")));
				body.appendChild(field("Prefix (optional)", textIn("prefix", "You are here:")));
				body.appendChild(
					field(
						"Truncate labels (chars, 0 = off)",
						el("input", {
							class: "uich-dd-input",
							type: "number",
							min: "0",
							value: String(state.truncate || 0),
							oninput: function (e) { state.truncate = parseInt(e.target.value, 10) || 0; refresh(); },
						}),
					),
				);
				body.appendChild(field("Show current page", checkIn("show_current")));
				body.appendChild(field("SEO schema (JSON-LD)", checkIn("schema")));
			},
			getTwig,
			opts.onInsert || noop,
		);
	}

	/* ------------------------------- bridge -------------------------------- */
	// Insert generated Twig into the editor. Priority: registered target -> focused textarea
	// -> dispatch a 'uich:dd:insert' event the panel can listen for.
	var _target = null;
	var _lastTextarea = null;
	var _lastCm5 = null; // last-focused CodeMirror 5 wrapper (the popup's code editors)
	document.addEventListener("focusin", function (e) {
		if (!e.target || !e.target.closest) {
			return;
		}
		if (e.target.tagName === "TEXTAREA") {
			_lastTextarea = e.target;
		}
		var wrap = e.target.closest(".CodeMirror");
		if (wrap && wrap.CodeMirror) {
			_lastCm5 = wrap.CodeMirror;
		}
	});

	// Return the active CodeMirror 5 instance: last-focused, else the focused one, else first visible.
	function activeCm5() {
		if (_lastCm5 && _lastCm5.getWrapperElement && _lastCm5.getWrapperElement().offsetParent !== null) {
			return _lastCm5;
		}
		var focused = document.querySelector(".uich-composer-host .CodeMirror-focused");
		if (focused && focused.CodeMirror) {
			return focused.CodeMirror;
		}
		var list = document.querySelectorAll(".uich-composer-host .CodeMirror");
		for (var i = 0; i < list.length; i++) {
			if (list[i].offsetParent !== null && list[i].CodeMirror) {
				return list[i].CodeMirror;
			}
		}
		return null;
	}

	var bridge = {
		setTarget: function (cb) {
			_target = cb;
		},
		insert: function (text) {
			if (typeof _target === "function") {
				_target(text);
				return;
			}

			// 1) CodeMirror 5 (the Atom popup's HTML/CSS/JS editors).
			var cm = activeCm5();
			if (cm) {
				cm.replaceSelection(text);
				cm.focus();
				return;
			}

			// 2) Plain textarea.
			var ta = document.activeElement && document.activeElement.tagName === "TEXTAREA" ? document.activeElement : _lastTextarea;
			if (ta) {
				var start = ta.selectionStart || ta.value.length;
				var end = ta.selectionEnd || ta.value.length;
				ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
				ta.dispatchEvent(new Event("input", { bubbles: true }));
				ta.focus();
				ta.selectionStart = ta.selectionEnd = start + text.length;
				return;
			}

			// 3) Last resort: clipboard + notify, so the snippet is never lost.
			document.dispatchEvent(new CustomEvent("uich:dd:insert", { detail: { text: text } }));
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(text);
				window.alert("Click into the Code editor first, then paste. Snippet copied:\n\n" + text);
			}
		},
	};

	window.UichDD = window.UichDD || {};
	window.UichDD.ui = { openValue: openValue, openLoop: openLoop, openCondition: openCondition, openForm: openForm, openBreadcrumbs: openBreadcrumbs };
	window.UichDD.bridge = bridge;

	// The single "+ Dynamic" menu's items → what each inserts.
	window.UichDD.MENU = [
		{ mode: "value", label: "Dynamic value", icon: "ti-database" },
		{ mode: "loop-start", label: "Loop start", icon: "ti-repeat" },
		{ mode: "loop-end", label: "Loop end", icon: "ti-repeat-off" },
		{ mode: "condition-start", label: "Condition start", icon: "ti-git-branch" },
		{ mode: "condition-end", label: "Condition end", icon: "ti-git-branch" },
		{ mode: "form-start", label: "Form start", icon: "ti-forms" },
		{ mode: "form-end", label: "Form end", icon: "ti-x" },
		{ mode: "breadcrumbs", label: "Breadcrumbs", icon: "ti-directions" },
	];

	// Convenience: open the right builder (or insert a closing token) and route through the bridge.
	window.UichDD.open = function (mode, context) {
		var ins = function (t) {
			bridge.insert(t);
		};
		var opts = { context: context, onInsert: ins };
		if (mode === "loop-end") {
			ins("\n{% endfor %}\n");
			return;
		}
		if (mode === "condition-end") {
			ins("\n{% endif %}\n");
			return;
		}
		if (mode === "form-end") {
			ins("\n</form>\n");
			return;
		}
		if (mode === "loop-start") {
			return openLoop({ onInsert: ins, part: "open" });
		}
		if (mode === "loop") {
			return openLoop(opts);
		}
		if (mode === "condition-start") {
			return openCondition({ context: context, onInsert: ins, part: "open" });
		}
		if (mode === "form-start" || mode === "form") {
			return openForm(opts);
		}
		if (mode === "condition") {
			return openCondition(opts);
		}
		if (mode === "breadcrumbs") {
			return openBreadcrumbs({ onInsert: ins, context: context });
		}
		return openValue(opts); // 'value'
	};

	// Load live field introspection (ACF / Meta Box / Woo / post types) and merge into the schema,
	// so the picker + Data/Condition builders list the site's real fields.
	(function () {
		var cfg = window.uichAtomFields;
		if (!cfg || !cfg.url || !S.extend) {
			return;
		}
		fetch(cfg.url, { headers: cfg.nonce ? { "X-WP-Nonce": cfg.nonce } : {} })
			.then(function (r) {
				return r.json();
			})
			.then(function (d) {
				try {
					S.extend(d);
					document.dispatchEvent(new CustomEvent("uich:dd:fields-loaded"));
				} catch (e) {}
			})
			.catch(function () {});
	})();
})();
