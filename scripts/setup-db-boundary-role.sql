-- setup-db-boundary-role.sql
-- Dedicated role creation and privilege boundary for ListFlow

-- 1. Create or update role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'listflow_app') THEN
    CREATE ROLE listflow_app WITH LOGIN PASSWORD 'SECURE_RANDOM_PASSWORD_PLACEHOLDER';
  END IF;
END
$$;

-- Allow listflow_app to access ListFlow tables without being blocked by default RLS flags on application tables
ALTER ROLE listflow_app BYPASSRLS;

-- 2. Atomic GRANT on public + REVOKE on AA tables + Default Privileges for future tables
BEGIN;

GRANT CONNECT ON DATABASE postgres TO listflow_app;
GRANT USAGE ON SCHEMA public TO listflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO listflow_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO listflow_app;

-- Explicitly revoke access to existing AA tables
REVOKE ALL ON TABLE
  public.subscriptions,
  public.subscription_history,
  public.stores,
  public.tools,
  public.tool_credentials,
  public.tool_notifications,
  public.profiles,
  public.pricing_packages,
  public.stripe_webhook_events,
  public.admin_audit_log,
  public.rate_limits,
  public.site_settings,
  public.services,
  public.educational_content,
  public.newsletter_subscribers,
  public.contacts,
  public.cp_bot_activity_log,
  public.cp_bot_cloud_clipboard,
  public.cp_bot_config,
  public.cp_bot_fulfillments,
  public.cp_bot_gift_templates,
  public.cp_bot_insight_cards,
  public.cp_bot_licenses,
  public.cp_bot_settings,
  public.learn_articles,
  public.learn_categories,
  public.article_comments,
  public.article_reactions,
  public.comment_likes,
  public.templates,
  public.label_history,
  public.user_roles
FROM listflow_app;

-- Explicitly revoke access to Supabase auth schema
REVOKE ALL ON SCHEMA auth FROM listflow_app;

-- Revoke default privileges for any future tables created by postgres
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM listflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM listflow_app;

COMMIT;
