# Readme

## About

GitHub Action for [Hugo](https://gohugo.io/), the world's fastest framework for
building websites.

---

- [Usage](#usage)
- [Customizing](#customizing)
  - [inputs](#inputs)
- [Keep up-to-date with GitHub Dependabot](#keep-up-to-date-with-github-dependabot)
- [How can I help?](#how-can-i-help)
- [License](#license)

## Usage

```yaml
name: hugo

on:
  pull_request:
  push:

jobs:
  hugo:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
      - name: Run Hugo
        uses: crazy-max/ghaction-hugo@v1
        with:
          version: latest
          extended: false
          args: --cleanDestinationDir --minify --verbose
      - name: Deploy to GitHub Pages
        if: success() && github.event_name != 'pull_request'
        uses: crazy-max/ghaction-github-pages@v2
        with:
          target_branch: gh-pages
          build_dir: public
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Customizing

### inputs

Following inputs can be used as `step.with` keys

| Name       | Type   | Default  | Description                      |
| ---------- | ------ | -------- | -------------------------------- |
| `version`  | String | `latest` | Hugo version. Example: `v0.58.3` |
| `extended` | Bool   | `false`  | Use Hugo extended                |
| `args`     | String |          | Arguments to pass to Hugo        |

## Keep up-to-date with GitHub Dependabot

Since
[Dependabot](https://docs.github.com/en/github/administering-a-repository/keeping-your-actions-up-to-date-with-github-dependabot)
has
[native GitHub Actions support](https://docs.github.com/en/github/administering-a-repository/configuration-options-for-dependency-updates#package-ecosystem),
to enable it on your GitHub repo all you need to do is add the
`.github/dependabot.yml` file:

```yaml
version: 2
updates:
  # Maintain dependencies for GitHub Actions
  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule:
      interval: 'daily'
```

## How can I help?

Thanks again for your support, it is much appreciated! :pray:

## License

MIT. See `LICENSE` for more details.
