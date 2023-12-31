# Project Management supabase + cloudflare template

Simple starter kit for the backend that can also be used as is to create a project management system similar to figma(without realtime collaboration right now) with supabase and cloudflare workers.

All infrastructure is defined as code in the project. The starter sql is present in `starter.sql`, the worker code is in `cf-worker/src/worker.ts` and a sample for the wrangler.toml is present in `wrangler.sample.toml`.

The starter sql creates the tables, functions, triggers, and policies required for the project. The worker code is a simple proxy to supabase with some additional functionality for user assets and avatar and poster iamges.

The cloudflare worker project can be used by using it as a template, by copying the code into an existing project, using it as a dependency or as a submodule. 
Using it as a dependency or a submodule makes it possible to upgrade the worker code easily, but makes it harder to modify the worker code to suit your needs.

Note: This is a very simple project and could serve as a starting point. But this in no way is a complete production ready system, and requires considerable work on the frontend.

Note: Good knowledge of postgreSQL, supabase and cloudflare workers is required to use this project.

## Database

### Tables

- profiles - stores user profiles and links to supabase auth users table
- projects - stores project details including jsonb data, poster, owner etc
- user_assets - stores user uploaded assets
- project_versions - automatic backups of json data of projects

## Setup

Here is the setup checklist, more details are below.

- [ ] Create a supabase project
- [ ] Run starter SQL script
- [ ] Create a wrangler.toml file for the worker from wrangler.sample.toml
- [ ] Set name and route in wrangler.toml, comment route and env.staging if not required.
- [ ] Create a bucket for user assets, update wrangler.toml
- [ ] Map the bucket to a domain, update wrangler.toml
- [ ] Set cors policy for the bucket
- [ ] Set the supabase url, anon token in wrangler.toml
- [ ] Deploy the worker for the first time
- [ ] Create a new .dev.vars file with the jwt secret for local development
- [ ] Set the jwt secret on deployment(s)
- [ ] Use the worker endpoint with supabase in the frontend.

### Supabase setup
Create a new supabase project, either a managed project from the supabase dashboard or a self hosted project.

Copy all the code from `starter.sql` and paste it into the SQL Editor in the supabase project. 

Press `Run` to create the tables, functions, triggers, and policies.

### Worker setup

Move into the `cf-worker` directory
```sh
cd cf-worker
```

Copy wrangler.sample.toml to wrangler.toml
```sh
cp wrangler.sample.toml wrangler.toml
```

Set the name, account_id of the worker in wrangler.toml
```toml
account_id = "<cloudflare account id>"
name = "<worker name>"
```

Create a bucket for user assets, and put the name in wrangler.toml
```sh
npx wrangler r2 bucket create <bucket-name>
```
```toml
[[r2_buckets]]
binding = "USER_ASSETS_BUCKET_1"
bucket_name = "<bucket name>"
```

Next [add a cors policy for the bucket](https://developers.cloudflare.com/r2/buckets/cors/#add-cors-policies-from-the-dashboard) to be able to access the files from the frontend.
Here's a sample for allowing all domains: 
```json
[
  {
    "AllowedOrigins": [ "*" ],
    "AllowedMethods": [ "GET" ]
  }
]
```
Set `*` to the domain for the frontend, if only one domain is required.

Map the bucket to a domain or enable public access from the cloudflare portal, then set `USER_ASSET_BASE_URL_1` in wrangler.toml to the domain or bucket url like:
```toml
USER_ASSET_BASE_URL_1 = "https://cdn1.<your domain>.com"
```

Set the `SUPABASE_URL`, `SUPABASE_ANON_TOKEN` variables in wrangler.toml to the url and jwt secret in the supabase project.
```toml
SUPABASE_URL = "https://<supabase project id>.supabase.co"
SUPABASE_ANON_TOKEN = "<supabase anonymous token>"
```

`SUPABASE_JWT_SECRET` has to be set as an encrypted value in the cloudflare dashboard or via cli(after first deployment).

It has to be set for every environment(like staging)

To set it via cli (do this after first deployment), run:
```sh
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put SUPABASE_JWT_SECRET --env staging
```

For local development create a `.dev.vars` with the secret:
```sh
echo "SUPABASE_JWT_SECRET=<jwt_secret>" > .dev.vars
```

## Test the worker locally 
    
```sh
npm run start # same as wrangler dev
```

## Deploy the worker 

Deploy to staging
```sh
npm run deploy # same as wrangler deploy --env staging
```

Deploy to prod
```sh
npm run deploy:prod # same as wrangler deploy
```

## Usage in frontend

Pass the worker url directly into the supabase `createClient` function.
```js
const supabase = createClient(
  'https://<worker name>.<your domain>.workers.dev', // or your custom domain mapped to the worker
  '0' // this can be '0' because defined in wrangler.toml
)
```

### Proxy to supabase

All the supabase API works as is, but the worker adds some additional functionality, like custom domains and removing the need to pass the anonymous key in the frontend. It could simply be an empty string if defined in wrangler.toml

Here's an example for making a direct request, but for most cases directly using supabase client will be enough.
```js
const response = await fetch(WORKER_URL + '/rest/v1/projects?select=*&limit=1', {
    headers: {
        'Authorization': 'Bearer ' + session.access_token
    },
})
```

### User asset management
PUT, DELETE, GET are allowed to `/api/v1/user_asset/<filePath>` if the user is logged in.
Login is verified by setting the Authorization header to the supabase access token. 

This will also create or delete the respective rows in the `user_assets` table in the supabase project.

Update is not possible, to update, delete and upload again with the same file path. The asset url will change on doing this.

#### Upload
Send a `PUT` request to `/api/v1/user_asset/<filePath>` and include the file in the body of the request. Set the `Content-Type` header to the mime type of the file.

```js
const response = await fetch(WORKER_URL + '/api/v1/user_asset/' + filePath + "?type=texture", {
    body: file,
    headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'Content-Type': file.type
    },
    method: 'PUT' 
})
```

#### Delete
Send a `DELETE` request to `/api/v1/user_asset/<filePath>`.

```js
const response = await fetch(WORKER_URL + '/api/v1/user_asset/' + filePath, {
    headers: {
        'Authorization': 'Bearer ' + session.access_token
    },
    method: 'DELETE' 
})
```

#### Download
Send a `GET` request to `/api/v1/user_asset/<filePath>`.

```js
const response = await fetch(WORKER_URL + '/api/v1/user_asset/' + filePath, {
    headers: {
        'Authorization': 'Bearer ' + session.access_token
    },
    method: 'GET' 
})
```

Note: this is for authenticated use only, to access the asset publicly, use the public asset url that's in the db or generated with the user asset base path.

### Image Management

Posters for user assets, projects and avatars for profiles can be uploaded and downloaded using the image endpoint. It adds extra features for serving and processing images.

The API works similar to the user_asset endpoint.

For user assets: `/api/v1/image/<filePath>`

For user profile avatars: `/api/v1/image/.profiles/<userId>`

For project posters: `/api/v1/image/.projects/<projectId>`

## Local development

```sh
npm run start # same as wrangler dev
```

## Deploy

```sh
npm run deploy # same as wrangler deploy
```


## Notes
File path should be unique per user
File path should not start with dot `.`
File path should not contain `..`
File path should not start with a number

Jetbrains IDEs(like Webstorm) can be used to connect to the supabase postgresql database. When connected all context-aware autocomplete work with the live database in SQL files.

When making changes to the database, its recommended to change the starter script and run the necessary commands on the database. For any additions to the database, consider creating a new SQL file and using that.
