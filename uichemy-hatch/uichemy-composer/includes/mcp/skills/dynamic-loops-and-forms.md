# Dynamic Loops and Forms

You were called because the user wants a section that is **not static** — it either **prints live site data** (a post/product listing, an author's fields, a price) or **collects input** (a contact / signup form that submits to WordPress). Both are built out of ordinary Composer widget markup; the difference is a small, exact contract you must follow so the server resolves it.

Two independent capabilities live here:

- **Dynamic output** — Twig-in-HTML (`{{ }}` / `{% %}`) that resolves to real content at render time. This is **OUTPUT**.
- **Forms** — a `<form data-atom-form="…">` that WordPress turns into a managed, validated, stored submission. This is **INPUT**.

Never confuse them: **Twig is output, forms are input.** Don't wrap form fields in `{% for %}`. (Twig may still pre-fill a field value, e.g. `value="{{ request.get('email') }}"`.)

---

## Before anything — know the site

1. Call `uichemy-composer/describe-site` **first**. Every post type, taxonomy, and term you reference must be one this site actually has — a guessed name renders **empty**, not an error, so the page looks built and is blank.
2. Before writing ANY token binding, call `uichemy-composer/dynamic (action="list-fields")` — the catalog of every token this build resolves (`post`, `product` [WooCommerce], `user`, `term`, `image`, `site`, `request`) **plus the site's own ACF / meta fields**. Bind only tokens that appear there.

The `dynamic` ability returns **markup and writes nothing** (except `list-fields`, which just reads). You take the returned HTML and pass it to `uichemy-composer/page`, `uichemy-composer/post`, or `uichemy-composer/template` to actually build.

---

## Part A — Dynamic output (tokens + loops)

### Tokens — printing one value

Print a token as-is with `{{ … }}`:

- `{{ post.title }}`, `{{ post.excerpt }}`, `{{ post.permalink }}`
- **Chaining** — a token that returns another provider: `{{ post.author.name }}`, `{{ post.thumbnail.src('large') }}`
- **Custom / ACF fields are meta** — reach them with `meta()`, never as a bare accessor: `{{ post.meta('price') }}`, image field: `{{ post.meta('hero').src('large') }}`. Use the exact `metaKey` from `list-fields`, never a guessed one.
- `product.*` (price, sale_percentage, …) resolves **only when WooCommerce is active**.

When you need the exact token for one field on one provider, call `uichemy-composer/dynamic (action="bind-field")`.

### Control flow

The Twig subset supported: `{{ output }}`, `{% if / elseif / else / endif %}`, `{% for x in y %}` / `{% for k, v in y %}` with `{% else %}`, `{% set name = expr %}`, `{# comments #}`, dot/bracket access, and filters. Arrays are what a loop repeats over:

```
{% for c in product.categories %}{{ c.name }}{% endfor %}
```

Always give a loop an empty state with `{% else %}` so a query with no results doesn't render a hollow shell.

### Listings — use `create-loop`, don't hand-write the query

To repeat one item's markup over a query, call `uichemy-composer/dynamic (action="create-loop")`. It wraps **your per-item markup** in a validated `{% for %}` and returns the finished HTML.

Params:

| Param | Meaning |
|---|---|
| `item_html` | **Required.** Markup for ONE item, using tokens for the loop variable (see below). |
| `source` | `posts` (default) · `products` · `terms` · `users`. `products` needs WooCommerce. |
| `post_type` | For `source=posts` (default `post`). Use a name from `describe-site` → `post_types[].name`. |
| `taxonomy` + `term` | Filter to a taxonomy term (both must be real). |
| `limit` | 1–100 (default 6). |
| `orderby` / `order` | e.g. `date` / `desc`. |
| `query` | Structured filter object: status, offset, include/exclude, author, date range, **one** meta clause. |
| `raw_query` | Escape hatch — the raw query args object, for what the structured `query` can't express (several post types, OR between taxonomies, more than one meta clause). Taken verbatim. |

The loop variable matches the source: `post` for posts, `product` for products, `term` for terms, `user` for users. So `item_html` for a post listing uses `{{ post.title }}`, `{{ post.thumbnail.src('medium') }}`, etc.

Example `item_html` for a blog grid card:

```html
<a class="card" href="{{ post.permalink }}">
  <img src="{{ post.thumbnail.src('medium') }}" alt="{{ post.title }}">
  <h3>{{ post.title }}</h3>
  <p>{{ post.excerpt }}</p>
</a>
```

### Server-side placeholders

For whole-region content that only WordPress can produce, use `uichemy-composer/dynamic (action="add-tag")` — it emits a placeholder resolved at render time: `post-content`, `nav-menu`, `site-logo`, `site-icon`, `toc`.

### How it renders

`{% %}` / `{{ }}` resolve **on the server** at render time. In the editor/preview the widget shows its current rendered markup until the save lands — never paint raw template tokens client-side, and never "fix" a token that looks unresolved in the panel; it resolves on the real request.

---

## Part B — Forms (input that submits to WordPress)

Mark any `<form>` as a managed form with a single attribute:

```html
<form data-atom-form="contact">
  <input type="text"  name="name"    placeholder="Your name" required>
  <input type="email" name="email"   placeholder="Email" required>
  <textarea name="message" placeholder="Message"></textarea>
  <button type="submit">Send</button>
</form>
```

Rules:

- **`data-atom-form="key"`** is the only requirement. The `key` names this form (used server-side to load its config and store entries).
- **Each field's `name=""` is its submission key.** Give every field a clear, unique `name`. Fields without a `name` are ignored.
- On render, the plugin auto-injects the REST endpoint, a nonce, a honeypot, a timestamp, and hidden metadata, and the front-end runtime handles the AJAX submit, validation (nonce / honeypot / timestamp / rate-limit), success + error messages, saving to the DB, and the email action. **You do not add any of that markup yourself** — no `action`, no `method`, no nonce field, no hidden inputs.

Optional per-form settings, as `data-atom-*` attributes on the `<form>`:

| Attribute | Effect |
|---|---|
| `data-atom-success="Thanks — we'll be in touch."` | Inline success message shown after submit. |
| `data-atom-redirect="/thank-you"` | Redirect to a URL on success (instead of / in addition to the message). |
| `data-atom-subject="New enquiry from {{ site.name }}"` | Subject line for the notification email. |

**Sensitive config is NOT put in page source.** Email recipients and webhook URLs are stored server-side (post meta), keyed by post + form key — never as attributes on the form. If the user wants those set, do it through the form's config, not by writing them into the HTML.

Submissions are saved to the database and are viewable in the UiChemy Forms dashboard.

---

## Do / Don't

- **Do** call `describe-site` and `list-fields` before binding anything real.
- **Do** use `create-loop` for listings rather than hand-authoring `{% for %}` + a query.
- **Do** give loops an `{% else %}` empty state and forms a `data-atom-success` message.
- **Don't** guess post types, taxonomies, terms, or meta keys — an unknown token renders blank.
- **Don't** add nonces, `action`/`method`, or hidden fields to a form — the plugin injects them.
- **Don't** loop over form inputs or expect `{{ }}` to collect data — Twig is output only.
