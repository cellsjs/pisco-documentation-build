'use strict';

const fs = require('fs-extra');
const path = require('path');

const Metalsmith = require('metalsmith');
const markdown = require('metalsmith-markdown');
const layouts = require('metalsmith-layouts');
const assets = require('metalsmith-assets');
const ignore = require('metalsmith-ignore');
const rootPath = require('metalsmith-rootpath');
const navigation = require('metalsmith-navigation');
const metadata = require('metalsmith-metadata');
const nunjucks = require('nunjucks');
const ghpages = require('gh-pages');
const nunjucksEnv = new nunjucks.Environment();

module.exports = {

  _cleanDist: function() {
    return new Promise((res, rej) => {
      this.logger.info(`Cleaning ${this.params.destination} folder...`);
      fs.remove(this.params.destination, (err) => {
        if (err) {
          this.logger.info('#red', `Error cleaning ${this.params.destination} folder`);
          return rej(err);
        }
        this.logger.info(`${this.params.destination} folder clean`);
        return res();
      });
    });
  },

  _checkFolder: function() {
    return new Promise((res, rej) => {
      // Check if docs folder exists
      this.logger.info(`Checking if ${this.params.docsSource} folder exists...`);
      if (!this.fsExists(this.params.docsSource)) {
        this.logger.info('#red', `${this.params.docsSource} folder does not exist, unable to create website`);
        rej();
      } else {
        this.logger.info(`${this.params.docsSource} folder found!`);
        res();
      }
    });
  },

  _filterTemplates: function(templateName) {
    return templateName.match(/^pisco-site-template-.*/);
  },

  _checkTemplate: function() {
    return new Promise((res, rej) => {
      this.logger.info('Searching for site templates in dependencies');

      const dependencies = this.fsReadConfig(this.pkgFile).dependencies;
      const templates = Object.keys(dependencies).filter(this._filterTemplates);

      if (templates.length) {
        this.logger.info(`Templates found: ${templates.length}`);

        if (templates.length > 1) {
          this._inquireTemplates(templates)
          .then(() => this._useTemplate(this.params.selectedTemplate))
          .then(res);
        } else {
          this._useTemplate(templates[0]);
          res();
        }
      } else {
        rej('There is no template in your dependencies, add one!');
      }
    });
  },
  _useTemplate(template) {
    this.logger.info('Using template:', '#yellow', `${template}`);
    this.params.templateSource = path.join('node_modules', template);
  },

  _inquireTemplates(templates) {
    this.params.templatesPrompt[0].choices = templates;
    return this.inquire('templatesPrompt');
  },

  _checkIndex: function() {
    return new Promise((res, rej) => {
      if (!this.fsExists(path.join(this.params.docsSource, 'index.md'))) {
        this.logger.info('#red', `index.md not found at ${this.params.docsSource} folder`);
        rej({message: 'index.md file is needed to create the site'});
      } else {
        this.logger.info('index.md file found!');
        return res();
      }
    });
  },

  _configNunjucks: function() {
    nunjucks.configure(path.join(this.params.templateSource, this.params.layouts), {watch: false});
    nunjucks.configure('views', {autoescape: false});
  },

  _configMetadata: function() {
    // Set valid targets
    this.params.extraMetadata.targets = this.params.targets;

    // Needed metadata for auto-generated index
    if (this.params.indexData) {
      Object.assign(this.params.extraMetadata, this.params.indexData);
    }

    // Funcion needed in nunjucks templates
    this.params.extraMetadata.isIn = function(str, arr) {
      return arr.indexOf(str) !== -1;
    };
  },

  _setAppMetadata: function(files, metalsmith, done) {
    let appMetadata = files['index.md'];

    this.params.extraMetadata.toolName = this.params.extraMetadata.toolName || appMetadata.toolName;
    this.params.extraMetadata.toolNpm = this.params.extraMetadata.toolNpm || appMetadata.npmName;
    this.params.extraMetadata.toolClaim = this.params.extraMetadata.toolClaim || appMetadata.claim;

    metalsmith.metadata(this.params.extraMetadata);

    done();
  },

  _publishGithupPage() {
    return new Promise((res, rej) => {
      this.logger.info('Publishing Github Page...');
      ghpages.publish(path.join(this.params.destination), (err) => {
        if (err) {
          this.logger.info('#red', 'Error uploading to github pages');
          rej({message: 'Error publishing github pages'});
        }
        this.logger.info('#green', 'Website published in github pages');
        res();
      });
    });
  },

  _uploadWebsite() {
    if (this.gitIsGithub()) {
      return Promise.resolve()
        .then(() => this.inquire('githupPagesPrompt'))
        .then(() => {
          if (this.params.githubPage) {
            return this._publishGithupPage();
          } else {
            this.logger.info('Skipping Github Page creation');
          }
        });
    }
  },

  check(ok, ko) {
    return Promise.resolve()
      .then(this._checkFolder)
      .then(this._checkTemplate)
      .then(this._checkIndex)
      .then(ok, ko);
  },

  config(ok, ko) {
    this.params.extraMetadata = {};

    return Promise.resolve()
      .then(this._cleanDist)
      .then(this._configNunjucks)
      .then(this._configMetadata)
      .then(ok, ko);
  },

  run(ok, ko) {
    return new Promise((res, rej) => {
      const navConfigs = {
        main: {
          includeDirs: true
        }
      };

      Metalsmith('./') //eslint-disable-line new-cap
        .use(this._setAppMetadata)
        .use(rootPath())
        .source(this.params.docsSource)
        .destination(this.params.destination)
        .use(ignore(this.params.ignore))
        .use(markdown())
        .use(navigation(navConfigs, {}))
        .use(layouts({
          engine: 'nunjucks',
          directory: path.join(this.params.templateSource, this.params.layouts)
        }))
        .use(assets({
          source: path.join(this.params.templateSource, this.params.assets)
        }))

        .build((err) => {
          if (err) {
            return rej(err);
          }
          this.logger.info('#green', `Website generated at ${this.params.destination}`);
          return res();
        });
    })
    .then(this._uploadWebsite)
    .then(ok, ko);
  }
};
