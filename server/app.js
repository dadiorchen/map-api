// const nock = require('nock');
// const nockBack = require('nock').back;
// nockBack.setMode('lockdown');
// nock.recorder.rec({
//   output_objects: true,
// });
const https = require('https');
const request = https.request;
https.request = (...args) => {
  console.warn('https.request is called:', args);
  console.error("mock https:");
  return request(...args)
};
const express = require('express');
const cors = require('cors');

const log = require('loglevel');
const Keycloak = require('keycloak-connect');
const session = require('express-session');
const HttpError = require('./utils/HttpError');
// const { errorHandler } = require('./utils/utils');
const { handlerWrapper } = require('./utils/utils');

const memoryStore = new session.MemoryStore();


const keycloak = new Keycloak({
  store: memoryStore,
});

const app = express();

if (process.env.NODE_ENV === 'development') {
  log.info('disable cors');
  app.use(cors());
}

app.use(keycloak.middleware({
  logout: '/logout',
  admin: '/'
}));

/*
 * Check request
 */
app.use(
  handlerWrapper(async (req, _res, next) => {
    if (
      req.method === 'POST' ||
      req.method === 'PATCH' ||
      req.method === 'PUT'
    ) {
      if (req.headers['content-type'] !== 'application/json') {
        throw new HttpError(
          415,
          'Invalid content type. API only supports application/json',
        );
      }
    }
    next();
  }),
);

app.use(express.urlencoded({ extended: false })); // parse application/x-www-form-urlencoded
app.use(express.json()); // parse application/json

// routers
app.get('/public', async (req, res) => {
  try {
    // const { method } = req;
    res.status(200).json({ ok: true });
  } catch (e) {
    console.log("error:", e);
  }
});

// app.get('/settings', keycloak.protect('realm:web-map-manager'), (req, res) => res.status(200).json({ ok: true }));

app.get('/settings', keycloak.enforcer('web-map-global-setting:view'), (req, res) => res.status(200).json({ ok: true }));

const knex = require('knex')({
  client: 'postgresql',
  connection: process.env.DB_URL,
  searchPath: 'webmap',
  debug: true,
});

app.get('/organizations/:organization_id/theme',
  // keycloak.enforcer('web-map-theme:view'),
  keycloak.enforcer(['web-map-theme:edit'],
    // keycloak.enforcer(['web-map-theme-for-organization-n:view'],
    {
      claims: function (request) {
        if (!request.params.organization_id) {
          throw new Error("organization_id is required");
        }
        const custom = [request.params.organization_id];
        console.warn("claim custom:", custom);
        return {
          custom,
        }
      }
    }
  ),
  async (req, res) => {
    const organization_id = req.params.organization_id;
    const theme = req.body.theme;
    // update database
    try {
      // select theme from database
      const result = await knex('map_config')
        .select('theme')
        .where({ organization_id });
      if (result.length === 0) {
        res.status(404).json({
          message: "not found",
        });
      }
      res.status(200).json(result[0]);
    } catch (e) {
      console.log("error:", e);
      res.status(500).json({ error: 500, message: "get error when select" });
    }
  })

app.post('/organizations/:organization_id/theme',
  keycloak.enforcer('web-map-theme:edit'),
  // keycloak.enforcer(['web-map-theme:edit'],
  //   {
  //     claims: function (request) {
  //       if (!request.params.organization_id) {
  //         throw new Error("organization_id is required");
  //       }
  //       return {
  //         organization_id: [request.params.organization_id]
  //       }
  //     }
  //   }),
  async (req, res) => {
    const organization_id = req.params.organization_id;
    console.warn("organization_id:", organization_id);
    const theme = req.body.theme;
    // update database
    try {
      const sql = `
      INSERT INTO map_config 
      (organization_id, theme) 
      VALUES
      (${organization_id}, ?)
      ON CONFLICT (organization_id) DO UPDATE 
        SET theme = ?
    `
      // run knex with sql and params
      const result = await knex.raw(sql, [theme, theme]);

      res.status(200).json({ ok: true });
    } catch (e) {
      console.log("error:", e);
      res.status(500).json({ error: 500, message: "get error when update" });
    }
  })

// Global error handler
// app.use(errorHandler);

const { version } = require('../package.json');

app.get('*', function (req, res) {
  res.status(200).send(version);
});

module.exports = app;
