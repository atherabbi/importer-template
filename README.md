# Importer website template

One template, reused for every importer. Each importer gets their own copy, their own website and their own admin screen at `their-site/admin/`.

Every time you save a change in the admin screen, the host rebuilds the site in about a minute. The rebuild regenerates all pages, the sitemap, `robots.txt` and the search-engine data on every page. You never edit those by hand.

## What is in this folder

| Folder or file | What it is |
| --- | --- |
| `content/` | Everything the admin screen edits: settings, products, brands, categories |
| `admin/` | The admin screen and its layout |
| `src/` | The design (styles), the small visitor script, and the fixed interface words in English and Bangla |
| `public/` | Files copied to the site as they are. Uploaded photos go to `public/uploads/` |
| `build.mjs` | Turns `content/` into the finished website in `dist/` |
| `netlify.toml` | Build settings, read automatically by Netlify |

## A. Set up the template (once)

1. Create a free account at github.com.
2. Create a new repository named `importer-template`. Private is fine.
3. On the empty repository page choose **uploading an existing file**, drag in everything from this folder, and commit.
4. Open the repository's **Settings** and tick **Template repository**.

## B. Start a site for a new importer (each time)

1. Open `importer-template` on GitHub, choose **Use this template → Create a new repository**, and name it after the importer, for example `acme-pharma-site`.
2. Put it online with one of these:
   - **Cloudflare:** Workers & Pages → Create → Pages → Connect to Git → pick the repository. Build command: `node build.mjs`. Build output directory: `dist`. Save and deploy.
   - **Netlify:** Add new site → Import an existing project → GitHub → pick the repository. The build settings are read from `netlify.toml`.
3. After about a minute the site is live at the temporary address the host gives you.

## C. Sign in to the admin screen

1. Open `https://the-site-address/admin/`.
2. Choose **Sign In with Token**. The screen links to GitHub's token page.
3. Create a fine-grained token with **Contents: Read and write** on the importer's repository. If you manage many importers, choose "All repositories" so one token works for every site.
4. Paste the token. The browser remembers it.

## D. Fill in the importer's content

Do these in the admin screen, in this order:

1. **Settings → Company and contact details:** name, logo, address, hotline, WhatsApp, email.
2. **Settings → Colours:** the main colour and the label colour. Dark-mode colours are worked out automatically.
3. **Settings → Show or hide sections:** switch off anything this importer does not need.
4. **Brands** and **Categories:** delete the samples and add the real ones.
5. **Products:** delete the samples and add the real ones. A product without a photo shows a drawing of its pack.
6. **Settings → Home page text:** headline, introduction and the points in each section. Clear the notice bar text or switch the notice bar off.

### What you can show or hide

Notice bar, home-page search box, importer label picture, "Check a pack", brands, products on the home page, "For doctors", the composition table, "For pharmacies", the inquiry form, footer contact details, the disclaimer, prices, registration numbers, the whole Bangla version, and any single product ("Show on website").

## E. Connect the importer's domain

1. In Cloudflare or Netlify, add the importer's domain to the project (Custom domains) and follow the DNS steps shown there.
2. In the admin screen, open **Settings → Search engines and languages** and enter the **Website address**, for example `https://www.acme-pharma.com`. The sitemap and all search-engine links use this address, so do not skip it.

## F. Tell the search engines (once per importer)

1. Open Google Search Console and add the domain as a property.
2. Choose the **HTML tag** method. Copy only the code inside `content="..."`.
3. Paste it in the admin screen under **Settings → Search engines and languages → Google Search Console verification code**. Save and wait a minute.
4. Back in Search Console, press **Verify**, then open **Sitemaps** and submit `sitemap.xml`.
5. For Bing, open Bing Webmaster Tools and choose **Import from Google Search Console**.

After this, Google re-reads the sitemap on its own. New and changed products are picked up without any further step.

## G. Inquiry form

A site made of plain files cannot send email by itself, so the form works in one of two ways:

- **By email:** get a free access key at web3forms.com using the importer's email address, and paste it in **Settings → Inquiry form**. Inquiries then arrive in that inbox.
- **By WhatsApp:** leave the key empty and fill in the WhatsApp number under Company details. The visitor gets a "Send on WhatsApp" button with the inquiry already written.

## What the build produces for search engines

- A separate page for every product, brand and category, in English and Bangla
- A title and description on every page, written from the product's own details
- `sitemap.xml` listing every page in both languages, with the date each page last changed
- `robots.txt` pointing to the sitemap and keeping the admin screen out of search results
- Product, organisation and breadcrumb data in the format Google reads for rich results
- Links between the English and Bangla version of each page, so Google shows the right language
- Share previews for Facebook and WhatsApp

## If something goes wrong

- **The admin page says "Admin is not connected yet".** In the host's project settings add an environment variable named `CMS_REPO` with the value `github-username/repository-name`, then deploy again.
- **The repository's main branch is not called `main`.** Add an environment variable `CMS_BRANCH` with the branch name.
- **A change does not appear.** Open the project in Cloudflare or Netlify and look at the latest deployment. The build log lists anything that needs attention as lines starting with "Note:".
- **The build fails on Cloudflare with a Node error.** Add an environment variable `NODE_VERSION` with the value `22`.

## Changing the design or the fixed words

- Fixed interface words such as button labels are in `src/strings.mjs`, in English and Bangla.
- The design is in `src/style.css`.
- Page layouts are in `build.mjs`.

To preview on your own computer, install Node.js, run `node build.mjs` in this folder, and open the `dist` folder with any local web server.
