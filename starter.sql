-- Database schema for a simple project management app.
-- Requires minimal supabase setup with auth enabled.

-- region Extensions
create extension if not exists moddatetime schema extensions;

-- endregion

-- region Table creation

-- Create a table for public profiles
create table public.profiles
(
    id         uuid references auth.users on delete cascade not null primary key,
    updated_at timestamp with time zone                     not null default now(),
    created_at timestamp with time zone                     not null default now(),
    username   text unique,
    full_name  text,
    avatar_url text,
    website    text,
    is_private boolean                                               default false,
    bio        text                                                  default '',
    constraint username_length check (char_length(username) >= 3)
);


-- Create table for projects. Each user can have multiple projects.
-- Projects are private by default, but can be shared with other users or made public. A project can have a single owner, but multiple editors and viewers.
-- Projects will also have a jsonb column for storing project data.
create table public.projects
(
    id           uuid                                         not null primary key default extensions.uuid_generate_v4(),
    slug         text unique                                  not null,
    updated_at   timestamp with time zone                     not null             default now(),
    created_at   timestamp with time zone                     not null             default now(),
    name         text                                         not null             default 'Untitled Project',
    description  text,
    is_private   boolean                                      not null             default true,
    is_template  boolean                                      not null             default false,
    owner_id     uuid references auth.users on delete cascade not null,
    editors      uuid[]                                       not null             default '{}'::uuid[],
    viewers      uuid[]                                       not null             default '{}'::uuid[],
    project_data jsonb                                        not null             default '{}'::jsonb,
    tags         text[]                                                            default '{}'::text[],
    poster_url   text,
    user_editing uuid                                         references auth.users on delete set null,
    user_editing_at timestamp with time zone,

    constraint slug_length check (char_length(slug) >= 3)
);

-- Create table for project versions. Each project can have multiple versions for tracking changes.
-- Version data will be stored in a jsonb column. Each row is a single version.
create table public.project_versions
(
    id           uuid                                       not null primary key default extensions.uuid_generate_v4(),
    created_at   timestamp with time zone                   not null             default now(),
    project_id   uuid references projects on delete cascade not null,
    project_data jsonb                                      not null             default '{}'::jsonb
);

-- Create table for user assets
create table public.user_assets
(
    id         uuid                     not null primary key default extensions.uuid_generate_v4(),
    updated_at timestamp with time zone not null             default now(),
    created_at timestamp with time zone not null             default now(),
    owner_id   uuid references auth.users on delete cascade,
    project_id uuid references projects on delete cascade,
    asset_data jsonb                    not null             default '{}'::jsonb,
    name       text                     not null,
    poster_url text,
    asset_url  text                     not null,
    size       bigint                   not null,
    asset_type text                     not null,
    is_private boolean                  not null             default true, -- This has to be supported by the client
    is_resource boolean                 not null             default false,

    -- One of owner_id or project_id must be set
    constraint owner_or_project check (owner_id is not null or project_id is not null)
);

-- endregion

-- region Enable Row Level Security (RLS)

alter table profiles
    enable row level security;
alter table projects
    enable row level security;
alter table project_versions
    enable row level security;
alter table user_assets
    enable row level security;

-- endregion

-- region Functions

-- region Trigger functions

-- This trigger automatically creates a profile entry when a new user signs up via Supabase Auth.
create or replace function public.handle_new_auth_user()
    returns trigger as
$$
begin
    insert into public.profiles (id, full_name, avatar_url)
    values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'avatar_url');
    return new;
end;
$$ language plpgsql security definer;

-- Create trigger to automatically create a new project version when a project is updated.
create or replace function public.handle_project_updated()
    returns trigger as
$$
begin
    if new.project_data = old.project_data then
        return new;
    end if;
    insert into public.project_versions (project_id, project_data)
    values (new.id, new.project_data);
    return new;
end;
$$ language plpgsql security definer;

-- endregion

-- region Access management functions

create or replace function public.can_user_access_project(project projects)
    returns boolean as
$$
begin
    return (project.is_private = false or auth.uid() = project.owner_id or auth.uid() = any (project.editors) or
            auth.uid() = any (project.viewers));
end;
$$ language plpgsql security definer;

create or replace function public.can_user_access_project_id(project_id uuid)
    returns boolean as
$$
begin
    return project_id is not null and can_user_access_project((select is_private, owner_id, editors, viewers from projects where id = project_id));
end;
$$ language plpgsql security definer;

-- create or replace function can_user_edit_project(project projects)
--     returns boolean as
-- $$
-- begin
--     return (auth.uid() = project.owner_id or auth.uid() = any (project.editors));
-- end;
-- $$ language plpgsql security definer;
--
-- create or replace function can_user_edit_project_id(project_id uuid)
--     returns boolean as
-- $$
-- begin
--     return project_id is not null and can_user_edit_project((select owner_id, editors from projects where id = project_id));
-- end;
-- $$ language plpgsql security definer;

-- endregion

-- region Project management functions

-- Function to create a new project
create or replace function public.create_project()
    returns projects as
$$
declare
    project      projects;
    project_slug text := '';
begin
    while project_slug = '' or exists(select 1 from projects where slug = project_slug)
        loop
            project_slug := substr(md5(random()::text), 0, 8);
        end loop;
    insert into projects (slug, owner_id)
    values (project_slug, auth.uid())
    returning * into project;
    return project;
end;
$$ language plpgsql security definer;

-- Function to call when starting editing a project.
create or replace function public.start_editing_project(project_id uuid)
    returns projects as
$$
declare
    project projects;
begin
    update projects
    set user_editing = auth.uid(), user_editing_at = now()
    where id = project_id
      and (user_editing is null or user_editing = auth.uid())
      and (owner_id = auth.uid() or auth.uid() = any (editors))
    returning * into project;
    return project;
end;
$$ language plpgsql security definer;

-- Function to call when stopping editing a project.
create or replace function public.stop_editing_project(project_id uuid)
    returns projects as
$$
declare
    project projects;
begin
    update projects
    set user_editing = null, user_editing_at = null
    where id = project_id
      and user_editing = auth.uid()
    returning * into project;
    return project;
end;
$$ language plpgsql security definer;

-- Function to update a project name, description, or slug. All are optional.
create or replace function public.update_project(
    project_id uuid,
    project_name text default null,
    project_description text default null,
    project_slug text default null,
    project_is_private boolean default null,
    project_is_template boolean default null,
    project_tags text[] default null,
    project_project_data jsonb default null,
    project_poster_url text default null
)
    returns projects as
$$
declare
    project projects;
begin
    update projects
    set name         = coalesce(project_name, name),
        description  = coalesce(project_description, description),
        slug         = coalesce(project_slug, slug),
        is_private   = coalesce(project_is_private, is_private),
        is_template   = coalesce(project_is_template, is_template),
        tags         = coalesce(project_tags, tags),
        project_data = coalesce(project_project_data, project_data),
        poster_url   = coalesce(project_poster_url, poster_url)
    where id = project_id
      and (owner_id = auth.uid() or auth.uid() = any (editors))
      and (user_editing = auth.uid())
    returning * into project;
    return project;
end;
$$ language plpgsql security definer;

-- Add a project member or viewer to a project
create or replace function public.add_project_member(
    project_id uuid,
    user_id uuid,
    is_editor boolean default false
)
    returns void as
$$
begin
    -- Don't allow users to add themselves as project members
    if user_id = auth.uid() then return; end if;
    -- check if user exists
    if not exists(select 1 from auth.users where id = user_id) then return; end if;
    update projects
    set editors = case when is_editor then array_append(editors, user_id) else editors end,
        viewers = case when is_editor then viewers else array_append(viewers, user_id) end
    where id = project_id
      and (owner_id = auth.uid() or auth.uid() = any (editors)); -- Owners and editors can add members
end;
$$ language plpgsql security definer;

-- Edit project member access
create or replace function public.edit_project_member_access(
    project_id uuid,
    user_id uuid,
    is_editor boolean default false
)
    returns void as
$$
begin
    -- Don't allow users to add themselves as project members
    if user_id = auth.uid() then return; end if;
    -- check if user exists
    if not exists(select 1 from auth.users where id = user_id) then return; end if;
    update projects
    set editors = case
                      when is_editor then array_append(array_remove(editors, user_id), user_id)
                      else array_remove(editors, user_id) end,
        viewers = case
                      when is_editor then array_remove(viewers, user_id)
                      else array_append(array_remove(viewers, user_id), user_id) end
    where id = project_id
      and (owner_id = auth.uid() or auth.uid() = any (editors)); -- Owners and editors can edit access level
end;
$$ language plpgsql security definer;

-- Remove a project member from a project
create or replace function public.remove_project_member(
    project_id uuid,
    user_id uuid
)
    returns void as
$$
begin
    update projects
    set editors = array_remove(editors, user_id),
        viewers = array_remove(viewers, user_id)
    where id = project_id
      and (owner_id = auth.uid() or user_id = auth.uid()); -- Users can remove themselves from projects
end;
$$ language plpgsql security definer;

-- endregion

-- region User Asset management functions

-- Function to create a new asset
create or replace function public.create_user_asset(
--     asset_project_id uuid default null,
    asset_name text,
    asset_asset_url text,
    asset_asset_type text,
    asset_size bigint,
    asset_asset_data jsonb default '{}'::jsonb,
    asset_is_private boolean default true,
    asset_is_resource boolean default false,
    asset_poster_url text default null
)
    returns user_assets as
$$
declare
    asset user_assets;
begin
    -- Check if user has permission to create asset
    if auth.uid() is null then
        raise exception 'User is not authenticated';
    end if;

    -- Check if project exists and user has access
--     if asset_project_id is not null and not exists(select 1 from projects where id = asset_project_id and (owner_id = auth.uid() or auth.uid() = any (editors))) then
--         raise exception 'Project does not exist or user does not have write access to project';
--     end if;

    -- Check if name is unique for this user
    if exists(select 1 from user_assets where name = asset_name and owner_id = auth.uid()) then
        raise exception 'Asset name is not unique';
    end if;

    -- Check if asset url is unique
    if exists(select 1 from user_assets where asset_url = asset_asset_url) then
        raise exception 'Asset url is not unique';
    end if;

    insert into user_assets (/*project_id,*/ name, asset_url, asset_type, asset_data, is_private, is_resource, size, poster_url, owner_id)
    values (/*asset_project_id,*/ asset_name, asset_asset_url, asset_asset_type, asset_asset_data, asset_is_private, asset_is_resource, asset_size, asset_poster_url, auth.uid())
    returning * into asset;
    return asset;
end;
$$ language plpgsql security definer;

-- Function to update a user asset (only asset_url, asset_type, asset_data, is_private, is_resource, size, poster_url)
create or replace function public.update_user_asset(
    asset_name text,
    asset_asset_type text default null,
    asset_asset_data jsonb default null,
    asset_is_private boolean default null,
    asset_is_resource boolean default null,
--     asset_asset_url text default null,
--     asset_size bigint default null,
    asset_poster_url text default null
)
    returns user_assets as
$$
declare
    asset user_assets;
begin
    -- Check if user has permission to update asset
    if auth.uid() is null then
        raise exception 'User is not authenticated';
    end if;

    -- Check if asset exists and user has access
    if not exists(select 1 from user_assets where name = asset_name and owner_id = auth.uid()) then
        raise exception 'Asset does not exist or user does not have write access to asset';
    end if;

    update user_assets
    set
--         asset_url = coalesce(asset_asset_url, asset_url),
--         size = coalesce(asset_size, size),
        asset_type = coalesce(asset_asset_type, asset_type),
        asset_data = coalesce(asset_asset_data, asset_data),
        is_private = coalesce(asset_is_private, is_private),
        is_resource = coalesce(asset_is_resource, is_resource),
        poster_url = coalesce(asset_poster_url, poster_url)
    where name = asset_name and owner_id = auth.uid()
    returning * into asset;
    return asset;
end;
$$ language plpgsql security definer;

-- update user asset url and size
create or replace function public.update_user_asset_url(
    asset_name text,
    asset_owner_id uuid,
    asset_asset_url text,
    asset_size bigint
)
    returns user_assets as
$$
declare
    asset user_assets;
begin
    -- Check if user has permission to update asset only service_role
    if auth.role() != 'service_role' then
        raise exception 'User is not authenticated';
    end if;

    -- Check if asset exists and user has access
    if not exists(select 1 from user_assets where name = asset_name and owner_id = asset_owner_id) then
        raise exception 'Asset does not exist or user does not have write access to asset';
    end if;

    update user_assets
    set
        asset_url = asset_asset_url,
        size = asset_size
    where name = asset_name and owner_id = asset_owner_id
    returning * into asset;
    return asset;
end;
$$ language plpgsql security definer;

-- Function to delete a user asset
create or replace function public.delete_user_asset(
    asset_name text
)
    returns user_assets as
$$
declare
    asset user_assets;
begin
    delete from user_assets
    where name = asset_name
      and owner_id = auth.uid()
    returning * into asset;
    return asset;
end;
$$ language plpgsql security definer;

-- endregion

-- region Profile functions

-- Function to update a user profile
create or replace function public.update_profile(
    user_full_name text default null,
    user_username text default null,
    user_website text default null,
    user_avatar_url text default null
)
    returns profiles as
$$
declare
    profile profiles;
begin
    update profiles
    set full_name = coalesce(user_full_name, full_name),
        username  = coalesce(user_username, username),
        website   = coalesce(user_website, website),
        avatar_url = coalesce(user_avatar_url, avatar_url)
    where id = auth.uid()
    returning * into profile;
    return profile;
end;
$$ language plpgsql security definer;

-- endregion

-- region Util Functions

create or replace function get_request_headers(header text)
    returns text as
$$
begin
    return current_setting('request.headers', true)::json->>header;
end;
$$ language plpgsql security definer;

-- Function to compute the total size of all assets for a user and the projects they own
create or replace function public.get_user_asset_size()
    returns bigint as
$$
begin
    return (select coalesce(sum(size), 0)
            from user_assets
            where owner_id = auth.uid()
               or (project_id in (select id from projects where owner_id = auth.uid())));
end;
$$ language plpgsql security definer;

-- endregion

-- region Fetch functions

-- Function to fetch all projects based on last updated at. Also returns the current time.
create or replace function public.fetch_updated_projects(
    last_updated_at timestamp with time zone default null
)
    returns jsonb as
$$
begin
    return jsonb_build_object('projects',
        (select jsonb_agg(row_to_json(projects))
         from projects
         where (is_template is true or owner_id = auth.uid()) and ( last_updated_at is null or updated_at > last_updated_at)),
        'last_updated_at', now());
end;
$$ language plpgsql security invoker stable;

-- Function to fetch all user_assets based on last updated at. Also returns the current time.
create or replace function public.fetch_updated_user_assets(
    last_updated_at timestamp with time zone default null
)
    returns jsonb as
$$
begin
    return jsonb_build_object('user_assets',
        (select jsonb_agg(row_to_json(user_assets))
         from user_assets
         where (is_resource is true or owner_id = auth.uid()) and ( last_updated_at is null or updated_at > last_updated_at)),
        'last_updated_at', now());
end;
$$ language plpgsql security invoker stable;

-- endregion

-- endregion

-- region Triggers

create trigger on_auth_user_created
    after insert
    on auth.users
    for each row
execute procedure public.handle_new_auth_user();

create trigger on_projects_updated
    after update
    on projects
    for each row
execute procedure public.handle_project_updated();

-- Automatically update the "updated_at" column when the row is changed.

create trigger handle_updated_at_profiles
    before update
    on profiles
    for each row
execute procedure extensions.moddatetime(updated_at);

create trigger handle_updated_at_projects
    before update
    on projects
    for each row
execute procedure extensions.moddatetime(updated_at);

create trigger handle_updated_at_user_assets
    before update
    on user_assets
    for each row
execute procedure extensions.moddatetime(updated_at);

-- endregion

-- region Create policies for RLS SELECT access

create policy "Public profiles are viewable by everyone." on profiles
    for select using (is_private = false);

create policy "Project can be seen if public or user is owner or collaborator." on projects
    for select using (can_user_access_project(projects));

create policy "Project versions can be accessed if the project is." on project_versions
    for select using (can_user_access_project_id(project_id));

create policy "User assets can be seen if public or user has project access" on user_assets
    for select using
    (is_private = false
        or (owner_id is not null and auth.uid() = owner_id)
        or can_user_access_project_id(project_id));

-- endregion

-- region Create indexes

create index on projects (slug);
create index on projects (owner_id);
create index on projects (editors);
create index on projects (viewers);

create index on project_versions (project_id);

create index on user_assets (owner_id);
create index on user_assets (project_id);
create index on user_assets (is_private);
create index on user_assets (asset_type);

create index on profiles (username);

-- endregion


-- Function to clear the db of all data and tables etc
create or replace function public.clear_db()
    returns void as
$$
begin
    drop schema public cascade;
    create schema public;
end;
$$ language plpgsql security definer;
