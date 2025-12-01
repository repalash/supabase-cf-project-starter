-- noinspection SqlNoDataSourceInspectionForFile

-- Database schema for a simple project management app.
-- Requires minimal supabase setup with auth enabled.

-- TODO - Add `set search_path = ''` in all the functions, and use public.table to access them.
--  See - https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0011_function_search_path_mutable

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
    cover_url  text                                                  default null,
    website    text,
    is_private boolean                                               default false,
    bio        text                                                  default '',
    plan       text                                        not null  default 'free',
    plan_expiry timestamp with time zone                             default null,
    follower_count int4 default 0 not null,

    constraint username_length check (char_length(username) >= 3)
);

-- create a table for user meta
create table public.user_meta
(
    id              uuid references auth.users on delete cascade not null primary key,
    updated_at      timestamp with time zone                     not null default now(),
    notification     jsonb                                        not null default '{}'::jsonb, -- notification settings
    username_history text[]                                      not null default '{}'::text[], -- username history
    last_username_change timestamp with time zone default now() not null,
    customer         jsonb                                       default null -- { "provider": "stripe", "id": "cus_..." }
);


-- Create table for projects. Each user can have multiple projects.
-- Projects are private by default, but can be shared with other users or made public. A project can have a single owner, but multiple editors and viewers.
-- Projects will also have a jsonb column for storing project data.
create table public.projects
(
    id             uuid                                         not null primary key default extensions.uuid_generate_v4(),
    slug           text unique                                  not null,
    updated_at     timestamp with time zone                     not null             default now(),
    created_at     timestamp with time zone                     not null             default now(),
    deleted_at     timestamp with time zone                                          default null,
    name           text                                         not null             default 'Untitled Project',
    description    text,
    is_private     boolean                                      not null             default true,
    is_template    boolean                                      not null             default false,
    owner_id       uuid not null,
    owner_username text                                                              default null,
    editors        uuid[]                                       not null             default '{}'::uuid[],
    viewers        uuid[]                                       not null             default '{}'::uuid[],
    project_data   jsonb                                        not null             default '{}'::jsonb,
    tags           text[]                                                            default '{}'::text[],
    poster_url     text,
    user_editing   uuid                                         references auth.users on delete set null,
    user_editing_at timestamp with time zone,
    like_count int4 default 0 not null,

    constraint slug_length check (char_length(slug) >= 3)
);
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT public_projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id);

-- Create table for project likes
create table public.project_likes
(
    id         uuid                     not null primary key default extensions.uuid_generate_v4(),
    project_id uuid references public.projects on delete cascade not null,
    user_id    uuid references public.profiles on delete cascade not null,
    created_at timestamp with time zone default now() not null,
    unique (project_id, user_id)
);

-- Create table for user follows
create table public.user_follows
(
    id         uuid                     not null primary key default extensions.uuid_generate_v4(),
    follower_id uuid references public.profiles on delete cascade not null,
    user_id    uuid references public.profiles on delete cascade not null,
    created_at timestamp with time zone default now() not null,
    unique (follower_id, user_id)
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

-- Create table for notifications. todo - notifications not updated for the last 3(or 7) days should be deleted.
create table public.user_notifications
(
    id         uuid                     not null primary key default extensions.uuid_generate_v4(),
    user_id    uuid references auth.users on delete cascade not null,
    project_id uuid references projects on delete cascade default null,
    updated_at timestamp with time zone default now() not null,
    type       text                     not null, -- 'like', 'comment', 'follow', 'mention', '_featured'
    users_ref  uuid[]                   not null, -- user_id of the users involved
    data       jsonb                    not null default '{}'::jsonb,
    is_read    boolean                  not null default false
--     unique (user_id, project_id, type)
);

-- add constraint for on conflict (user_id, project_id, type)
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_user_id_project_id_type_key UNIQUE (user_id, project_id, type);

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

-- create table for project comments
create table public.project_comments
(
    id         uuid                     not null primary key default extensions.uuid_generate_v4(),
    project_id uuid references public.projects on delete cascade not null,
    user_id    uuid references public.profiles on delete cascade not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    comment    text                     not null,
    parent_id  uuid                     default null,
    like_count int4 default 0 not null
);

-- endregion

-- region Enable Row Level Security (RLS)

alter table profiles
    enable row level security;
alter table projects
    enable row level security;
alter table project_likes
    enable row level security;
alter table project_versions
    enable row level security;
alter table user_follows
    enable row level security;
alter table user_assets
    enable row level security;
alter table user_notifications
    enable row level security;
alter table project_comments
    enable row level security;
alter table user_meta
    enable row level security;

-- endregion

-- region Functions

-- region Trigger functions

-- This trigger automatically creates a profile entry when a new user signs up via Supabase Auth.
create or replace function public.handle_new_auth_user()
    returns trigger as
$$
begin
    insert into public.profiles (id, full_name, username, avatar_url)
    values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'username',new.raw_user_meta_data ->> 'avatar_url');

    insert into public.user_meta (id)
    values (new.id);

    return new;
end;
$$ language plpgsql security definer;

-- Trigger to automatically create a new project version when a project is updated.
create or replace function public.handle_project_updated()
    returns trigger as
$$
begin
    if new.project_data = old.project_data or new.project_data is null then
        return new;
    end if;
    insert into public.project_versions (project_id, project_data)
    values (new.id, new.project_data);
    return new;
end;
$$ language plpgsql security definer;

-- Trigger to automatically update the owner_username column when the owner_id is updated.
create or replace function public.handle_project_owner_updated()
    returns trigger as
$$
begin
    if new.owner_id = old.owner_id or new.owner_id is null then
        return new;
    end if;
    update projects
    set owner_username = (select username from profiles where id = new.owner_id)
    where id = new.id;
    return new;
end;
$$ language plpgsql security definer;

-- Trigger to automatically update the owner_username column when the username updates in profiles.
create or replace function public.handle_profile_username_updated()
    returns trigger as
$$
begin
    if new.username = old.username or new.username is null then
        return new;
    end if;
    update user_meta
    set username_history = array_append(username_history, old.username), last_username_change = now()
    where id = new.id;
    update projects
    set owner_username = new.username
    where owner_id = new.id;
    return new;
end;
$$ language plpgsql security definer;

-- Trigger to update like_count when a like is added or removed
create or replace function public.update_project_like_count()
    returns trigger as
$$
begin
    if tg_op = 'INSERT' then
        update public.projects
        set like_count = like_count + 1
        where id = NEW.project_id;
    elsif tg_op = 'DELETE' then
        update public.projects
        set like_count = like_count - 1
        where id = OLD.project_id;
    end if;
    return null;
end;
$$ language plpgsql security definer;

-- Trigger to update follower_count when a follower is added or removed
create or replace function public.update_user_follower_count()
    returns trigger as
$$
begin
    if tg_op = 'INSERT' then
        update public.profiles
        set follower_count = follower_count + 1
        where id = NEW.user_id;
    elsif tg_op = 'DELETE' then
        update public.profiles
        set follower_count = follower_count - 1
        where id = OLD.user_id;
    end if;
    return null;
end;
$$ language plpgsql security definer;

-- endregion

-- region Access management functions

-- todo: remove deleted_at check and put in frontend
create or replace function public.can_user_access_project(project projects)
    returns boolean as
$$
begin
    return project.deleted_at is null and (project.is_private = false or auth.uid() = project.owner_id or auth.uid() = any (project.editors) or
            auth.uid() = any (project.viewers));
end;
$$ language plpgsql security definer;

create or replace function public.can_user_access_project_id(project_id uuid)
    returns boolean as
$$
begin
    return project_id is not null and exists(select 1 from projects where id = project_id and can_user_access_project(projects));
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
    username     text := (select username from profiles where id = auth.uid());
    project_slug text := '';
begin
    while project_slug = '' or exists(select 1 from projects where slug = project_slug)
        loop
            project_slug := substr(md5(random()::text), 0, 8);
        end loop;
    insert into projects (slug, owner_id, owner_username)
    values (project_slug, auth.uid(), username)
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
--     project_tags text[] default null,
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
        is_template  = coalesce(project_is_template, is_template),
--         tags         = coalesce(project_tags, tags), -- todo remove
        project_data = coalesce(project_project_data, project_data),
        poster_url   = coalesce(project_poster_url, poster_url)
    where id = project_id
      and (owner_id = auth.uid() or auth.uid() = any (editors))
      and (user_editing = auth.uid())
    returning * into project;
    return project;
end;
$$ language plpgsql security definer;

-- Toggle tag in a project
create or replace function public.toggle_project_tag(
    project_id uuid,
    tag text,
    do_set boolean
)
    returns void as
$$
begin
    if tag = '' or tag is null or tag like '\_%' then
        raise exception 'Forbidden tag';
    end if;

    update projects
    set tags = case when do_set then array_append(tags, tag) else array_remove(tags, tag) end
    where id = project_id
      and not (tag = any (tags))
      and (owner_id = auth.uid() or auth.uid() = any (editors));
end;
$$ language plpgsql security definer;

-- Trigger to notify user when a project is liked or user is followed
create or replace function public.notify_user(i_project_id uuid, o_user_id uuid, i_user_id uuid, i_type text)
    returns void as
$$
begin
    -- todo check the notification settings etc
    -- auth.uid() should be i_user_id (the user who liked/followed) since its definer
    if auth.uid() is null or auth.uid() != i_user_id then
        raise exception 'User is not authenticated';
    end if;
    if i_user_id = o_user_id then
        return;
    end if;
    -- or insert new notification. no need for data.
    -- update notification if already exists(in last 3 days), adding user_id to users_ref
    insert into public.user_notifications (user_id, project_id, type, users_ref)
    values (o_user_id, i_project_id, i_type, array[i_user_id]::uuid[])
    on conflict (user_id, project_id, type) -- where updated_at > now() - interval '3 days' -- todo test this...
        do update set users_ref = array_append(user_notifications.users_ref, i_user_id), is_read = false
        where not (i_user_id = any (user_notifications.users_ref));

--   todo remove from users_ref when user unlikes/unfollows?
--   todo  perform pg_notify('notification', jsonb_build_object('type', 'like', 'notification_id', notification_id)::text);

end;
$$ language plpgsql security definer;

-- Add/remove featured tag to a project (only for example.com emails)
create or replace function public.set_project_tag_protected(
    project_id uuid,
    tag text,
    do_set boolean
)
    returns void as
$$
begin
    update projects
    set tags = case when do_set then array_append(tags, tag) else array_remove(tags, tag) end
    where id = project_id
      and (auth.jwt()->>'email' like '%@ijewel3d.com');

    -- if tag is _featured then notify the user that their project is featured
    if tag = '_featured' and do_set then
        perform public.notify_user(project_id, (select owner_id from projects where id = project_id), auth.uid(), tag);
    end if;
end;
$$ language plpgsql security definer;


-- Function to like/unlike a project
create or replace function public.like_project(l_project_id uuid, do_like boolean)
    returns void as
$$
begin
    -- check if logged in
    if auth.uid() is null then
        raise exception 'User is not authenticated';
    end if;
    if do_like then
        insert into public.project_likes (project_id, user_id)
        values (l_project_id, auth.uid())
        on conflict do nothing;
    else
        delete from public.project_likes
        where project_id = l_project_id
          and user_id = auth.uid();
    end if;
end;
$$ language plpgsql security invoker;

-- Function to follow/unfollow a user
create or replace function public.follow_user(l_user_id uuid, do_follow boolean)
    returns void as
$$
begin
    -- check if logged in
    if auth.uid() is null then
        raise exception 'User is not authenticated';
    end if;
    if do_follow then
        insert into public.user_follows (follower_id, user_id)
        values (auth.uid(), l_user_id)
        on conflict do nothing;
    else
        delete from public.user_follows
        where follower_id = auth.uid()
          and user_id = l_user_id;
    end if;
end;
$$ language plpgsql security invoker;

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

-- Delete a project

create or replace function public.delete_project(
    project_id uuid
)
    returns projects as
$$
declare
    project projects;
begin
    update projects
    set deleted_at = now()
    where id = project_id
      and owner_id = auth.uid()
      and deleted_at is null
    returning * into project;
    return project;
end;
$$ language plpgsql security definer;

-- Full Delete. This can have user_assets linked in the project_data, so that needs to be cleared.
-- create or replace function public.full_delete_project(
--     project_id uuid
-- )
--     returns projects as
-- $$
-- declare
--     project projects;
-- begin
--     delete from projects
--     where id = project_id
--       and owner_id = auth.uid()
--     returning * into project;
--     return project;
-- end;
-- $$ language plpgsql security definer;

-- endregion

-- region User Asset management functions

-- Function to create a new asset
create or replace function public.create_user_asset(
    asset_name text,
    asset_asset_url text,
    asset_asset_type text,
    asset_size bigint,
    asset_project_id uuid default null,
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
    if asset_project_id is not null and not exists(select 1 from projects where id = asset_project_id and (owner_id = auth.uid() or auth.uid() = any (editors))) then
        raise exception 'Project does not exist or user does not have write access to project';
    end if;

    -- Check if name is unique for this user
    if exists(select 1 from user_assets where name = asset_name and owner_id = auth.uid()) then
        raise exception 'Asset name is not unique';
    end if;

    -- Check if asset url is unique
    if exists(select 1 from user_assets where asset_url = asset_asset_url) then
        raise exception 'Asset url is not unique';
    end if;

    insert into user_assets (project_id, name, asset_url, asset_type, asset_data, is_private, is_resource, size, poster_url, owner_id)
    values (asset_project_id, asset_name, asset_asset_url, asset_asset_type, asset_asset_data, asset_is_private, asset_is_resource, asset_size, asset_poster_url, auth.uid())
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
    -- Check if user has permission to update asset only service_role. TODO: its not required since we are using security invoker
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
$$ language plpgsql security invoker;

-- Function to delete a user asset. Call as admin(from worker).
-- TODO: only allow the backend to call this, not the user, and see other functions also
-- TODO: or create webhook to delete file on cloudflare r2 when a row is deleted, this will be useful with project delete also
create or replace function public.delete_user_asset(
    asset_owner_id uuid,
    asset_name text
)
    returns user_assets as
$$
declare
    asset user_assets;
begin
    delete from user_assets
    where name = asset_name
      and owner_id = asset_owner_id
--       and owner_id = auth.uid()
    returning * into asset;
    return asset;
end;
$$ language plpgsql security invoker;

-- endregion

-- region Profile functions

-- Function to update a user profile
create or replace function public.update_profile(
    user_full_name text default null,
    user_username text default null,
    user_website text default null,
    user_avatar_url text default null,
    user_cover_url text default null,
    user_bio text default null,
    user_is_private boolean default false
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
        avatar_url = coalesce(user_avatar_url, avatar_url),
        cover_url = coalesce(user_cover_url, cover_url),
        bio = coalesce(user_bio, bio),
        is_private = coalesce(user_is_private, is_private)
    where id = auth.uid()
    returning * into profile;
    return profile;
end;
$$ language plpgsql security definer;

-- Function to get user meta customer
create or replace function public.get_user_meta_customer(user_id uuid)
    returns jsonb as
$$
begin
    if auth.role() != 'service_role' then
        raise exception 'User is not authenticated';
    end if;
    
    return (select customer from user_meta where id = user_id);
end;
$$ language plpgsql security definer;

-- Function to update user meta customer
create or replace function public.update_user_meta_customer(user_id uuid, customer_data jsonb)
    returns void as
$$
begin
    if auth.role() != 'service_role' then
        raise exception 'User is not authenticated';
    end if;

    update user_meta
    set customer = customer_data
    where id = user_id;
end;
$$ language plpgsql security definer;

-- Function to update user meta
create or replace function public.update_user_meta(
    user_notification jsonb
)
    returns user_meta as
$$
declare
    meta user_meta;
begin
    update user_meta
    set notification = coalesce(user_notification, notification)
    where id = auth.uid()
    returning * into meta;
    return meta;
end;
$$ language plpgsql security definer;

-- Function to update a user profile plan and expiry. This will be called from the worker, triggered by stripe webhook.
create or replace function public.update_profile_plan(
    user_email text,
    user_plan text,
    user_plan_expiry numeric -- in seconds
)
    returns profiles as
$$
declare
    profile profiles;
begin
    -- Check if user has permission to update asset only service_role. TODO: make a new service role for stripe and use that
    if auth.role() != 'service_role' then
        raise exception 'User is not authenticated';
    end if;

    update profiles
    set plan = user_plan,
        plan_expiry = to_timestamp(user_plan_expiry)
    where id = (select id from auth.users au where au.email = user_email)
    returning * into profile;
    return profile;
end;
$$ language plpgsql security definer; -- note that this is definer

-- Function to update a user profile plan on expiry. sets the plan to free and expiry to null
create or replace function public.expire_profile_plan(
    user_email text,
    if_current_plan text
)
    returns profiles as
$$
declare
    profile profiles;
    uid uuid;
begin
    -- Check if user has permission to update asset only service_role. TODO: make a new service role for stripe and use that
    if auth.role() != 'service_role' then
        raise exception 'User is not authenticated';
    end if;

    select id into uid from auth.users where email = user_email;

    update profiles
    set plan = 'free',
        plan_expiry = null
    where id = uid
      and plan = if_current_plan;

    select * into profile from profiles where id = uid;
    return profile;
end;
$$ language plpgsql security definer;  -- note that this is definer

-- function to get the email for a uid. used in worker to check the uid is valid or not
create or replace function public.get_email_for_uid(
    user_id uuid
)
    returns text as
$$
declare
    email text;
begin
    -- Check if user has permission to query this. only service_role.
    if auth.role() != 'service_role' then
        raise exception 'User is not authenticated';
    end if;

    select au.email into email from auth.users au where id = user_id;
    return email;
end;
$$ language plpgsql security definer ;

-- Function to get customer details (email and customer object from user_meta)
create or replace function public.get_customer_details(user_id uuid)
    returns jsonb as
$$
declare
    result jsonb;
begin
    if auth.role() != 'service_role' then
        raise exception 'User is not authenticated';
    end if;

    select jsonb_build_object(
        'email', au.email,
        'customer', um.customer
    ) into result
    from auth.users au
    left join public.user_meta um on au.id = um.id
    where au.id = user_id;

    return result;
end;
$$ language plpgsql security definer;

-- todo add some check or rate limit here?
create or replace function public.check_user_exists(
    p_username text,
    p_email text
)
    returns jsonb as
$$
begin
    return jsonb_build_object(
        'username_exists', exists(
            select 1
            from public.profiles
            where username = p_username
        ),
        'email_exists', exists(
            select 1
            from auth.users
            where email = p_email
        )
    );
end;
$$ language plpgsql security definer;

create or replace function public.check_username_history(p_username text)
returns text as $$
declare
    profile_username text;
begin
    select p.username
    into profile_username
    from profiles p join user_meta um ON p.id = um.id
    where p.username = p_username OR p_username = ANY(um.username_history)
    order by p.created_at
    limit 1;
    return profile_username;
END;
$$ LANGUAGE plpgsql security definer;
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

-- Function to get the top project owners based on the number of projects they own.
CREATE FUNCTION public.get_top_public_project_owners(limit_count integer DEFAULT 10) RETURNS TABLE(id uuid, username text, avatar_url text, project_count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
RETURN QUERY
SELECT
    u.id,
    u.username,
    u.avatar_url,
    COUNT(p.id) AS project_count
FROM
    profiles u
        JOIN projects p ON u.id = p.owner_id
WHERE
    p.is_private = FALSE
GROUP BY
    u.id, u.username
ORDER BY
    project_count DESC
    LIMIT
        limit_count;
END;
$$;
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
    on public.projects
    for each row
execute procedure public.handle_project_updated();

-- Automatically update the "updated_at" column when the row is changed.

create trigger handle_updated_at_profiles
    before update
    on public.profiles
    for each row
execute procedure extensions.moddatetime(updated_at);

create trigger handle_updated_at_user_meta
    before update
    on public.user_meta
    for each row
execute procedure extensions.moddatetime(updated_at);

create trigger handle_updated_at_notifications
    before update
    on public.user_notifications
    for each row
execute procedure extensions.moddatetime(updated_at);

CREATE OR REPLACE FUNCTION public.handle_updated_at_projects_fn()
    RETURNS TRIGGER AS $$
BEGIN
    -- Check if any column other than `like_count` has changed
    IF (
        (NEW.* IS DISTINCT FROM OLD.*) -- Detect any changes
            AND (NEW.like_count = OLD.like_count) -- Exclude changes in `like_count`
        ) THEN
        NEW.updated_at = now();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

create trigger handle_updated_at_projects
    before update
    on public.projects
    for each row
execute procedure public.handle_updated_at_projects_fn();

-- create trigger handle_updated_at_projects
--     before update
--     on public.projects
--     for each row
-- execute procedure extensions.moddatetime(updated_at);

create trigger handle_updated_at_user_assets
    before update
    on public.user_assets
    for each row
execute procedure extensions.moddatetime(updated_at);

create trigger handle_updated_at_project_comments
    before update
    on public.project_comments
    for each row
execute procedure extensions.moddatetime(updated_at);


create trigger handle_owner_update_projects
    after update
    on public.projects
    for each row
execute procedure public.handle_project_owner_updated();

create trigger handle_username_update_profiles
    after update
    on public.profiles
    for each row
execute procedure public.handle_profile_username_updated();

create trigger update_follower_count_trigger
    after insert or delete
    on public.user_follows
    for each row
execute procedure public.update_user_follower_count();

create trigger update_like_count_trigger
    after insert or delete
    on public.project_likes
    for each row
execute procedure public.update_project_like_count();

create or replace function public.notify_project_like()
    returns trigger as
$$
begin
    perform public.notify_user(NEW.project_id, (select owner_id from projects where id = NEW.project_id), NEW.user_id, 'like');
    return new;
end;
$$ language plpgsql security invoker;

create trigger notify_project_like_trigger
    after insert
    on public.project_likes
    for each row
execute procedure public.notify_project_like();

create or replace function public.notify_project_comment()
    returns trigger as
$$
begin
    perform public.notify_user(NEW.project_id, (select owner_id from projects where id = NEW.project_id), NEW.user_id, 'comment');
    return new;
end;
$$ language plpgsql security invoker;

create trigger notify_project_comment_trigger
    after insert
    on public.project_comments
    for each row
execute procedure public.notify_project_comment();

create or replace function public.notify_user_follow()
    returns trigger as
$$
begin
    perform public.notify_user(null, NEW.user_id, NEW.follower_id, 'follow');
    return new;
end;
$$ language plpgsql security invoker;

create trigger notify_user_follow_trigger
    after insert
    on public.user_follows
    for each row
execute procedure public.notify_user_follow();

-- endregion

-- region Create policies for RLS SELECT access

create policy "Public profiles are viewable by everyone." on profiles
    for select using (is_private = false);

create policy "User can see their own meta" on user_meta
    for select using (auth.uid() = id);

create policy "Project can be seen if public or user is owner or collaborator." on projects
    for select using (can_user_access_project(projects));

create policy "Project versions can be accessed if the project is." on project_versions
    for select using (can_user_access_project_id(project_id));

create policy "User assets can be seen if public or user has project access" on user_assets
    for select using
    (is_private = false
        or (owner_id is not null and auth.uid() = owner_id)
        or can_user_access_project_id(project_id));

create policy "Comments can be seen if project can be seen" on project_comments
    for select using (can_user_access_project_id(project_id));

create policy "Comments can be inserted if project can be seen" on project_comments
    for insert to authenticated with check (can_user_access_project_id(project_id));

create policy "Comments can be updated if user is owner" on project_comments
    for update to authenticated using (auth.uid() = user_id);

create policy "Comments can be deleted if user is owner" on project_comments
    for delete to authenticated using (auth.uid() = user_id);

create policy "Users can read their notifications" on public.user_notifications
    for select to authenticated using (auth.uid() = user_id);

create policy "Users can update their notifications" on public.user_notifications
    for update to authenticated using (auth.uid() = user_id);

create policy "Users can like projects" on public.project_likes
    for insert to authenticated with check (auth.uid() = user_id);

create policy "Users can unlike projects" on public.project_likes
    for delete to authenticated using (auth.uid() = user_id);

create policy "Users can read their likes" on public.project_likes
    for select to authenticated using (auth.uid() = user_id);

create policy "Users can follow other users" on public.user_follows
    for insert to authenticated with check (auth.uid() = follower_id);

create policy "Users can unfollow other users" on public.user_follows
    for delete to authenticated using (auth.uid() = follower_id);

create policy "Users can read their follows" on public.user_follows
    for select to authenticated using (auth.uid() = follower_id);

-- endregion

-- region Create indexes

create index on projects (slug);
create index on projects (owner_id);
create index on projects (editors);
create index on projects (viewers);
create index on projects (owner_username);
create index on projects (created_at);

create index on project_versions (project_id);

create index on user_assets (owner_id);
create index on user_assets (project_id);
create index on user_assets (is_private);
create index on user_assets (asset_type);

create index on project_comments (project_id);

create index on profiles (username);

create index on user_meta (id);

create index on project_likes (project_id);
create index on project_likes (user_id);

-- create index on user_follows (follower_id);
-- create index on user_follows (user_id);

-- create index on user_notifications (user_id);

CREATE INDEX idx_projects_like_count_desc ON projects (like_count DESC);
CREATE INDEX idx_projects_tags_gin ON projects USING GIN (tags);


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
