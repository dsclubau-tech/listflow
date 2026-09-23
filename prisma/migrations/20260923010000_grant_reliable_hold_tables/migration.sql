-- The app and local workers connect as listflow_app, while deployment
-- migrations create tables as postgres. Grant access to the new tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'listflow_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AmazonPriceObservation" TO listflow_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ListingOperation" TO listflow_app';
  END IF;
END
$$;
