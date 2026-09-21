CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'TRESORIER' CHECK (role IN ('ADMIN', 'TRESORIER', 'PRESIDENT', 'BUREAU', 'BENEVOLE')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  bank TEXT,
  bank_address TEXT,
  manager_name TEXT,
  iban TEXT,
  rib TEXT,
  contract_filename TEXT,
  contract_path TEXT,
  contract_mime TEXT,
  bankin_connected BOOLEAN NOT NULL DEFAULT false,
  bankin_account_id TEXT,
  last_synced_at TIMESTAMPTZ,
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bank_address TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS manager_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS rib TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contract_filename TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contract_path TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contract_mime TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bankin_connected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bankin_account_id TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('RECETTE', 'DEPENSE', 'MIXTE')),
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, kind)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  budget NUMERIC(14,2),
  starts_on DATE,
  ends_on DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  parent_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_parent_id_fkey' AND conrelid = 'projects'::regclass) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_parent_not_self' AND conrelid = 'projects'::regclass) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'EN_COURS' CHECK (status IN ('IDEE', 'MONTAGE', 'EN_COURS', 'TERMINE', 'AVORTE'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);

-- Sérialise les changements de hiérarchie et interdit les cycles, y compris en accès SQL direct.
CREATE OR REPLACE FUNCTION check_project_parent_cycle() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(82620261);
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id OR EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM projects WHERE id = NEW.parent_id
      UNION ALL
      SELECT p.id, p.parent_id FROM projects p JOIN ancestors a ON p.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Un projet ne peut pas être son propre ancêtre.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS projects_parent_cycle_check ON projects;
CREATE TRIGGER projects_parent_cycle_check
  BEFORE INSERT OR UPDATE OF parent_id ON projects
  FOR EACH ROW EXECUTE FUNCTION check_project_parent_cycle();

ALTER TABLE categories ADD COLUMN IF NOT EXISTS project_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_project_id_fkey' AND conrelid = 'categories'::regclass) THEN
    ALTER TABLE categories ADD CONSTRAINT categories_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);

-- Un enfant reste dans le même projet et conserve le même type que son parent.
CREATE OR REPLACE FUNCTION check_category_parent_compatibility() RETURNS trigger AS $$
DECLARE
  parent_project_id UUID;
  parent_kind TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(82620262);
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id OR EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM categories WHERE id = NEW.parent_id
        UNION ALL
        SELECT c.id, c.parent_id FROM categories c JOIN ancestors a ON c.id = a.parent_id
      )
      SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Une catégorie ne peut pas être son propre ancêtre.' USING ERRCODE = '23514';
    END IF;
    SELECT project_id, kind INTO parent_project_id, parent_kind FROM categories WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Catégorie parente introuvable.' USING ERRCODE = '23503';
    END IF;
    IF parent_project_id IS DISTINCT FROM NEW.project_id OR parent_kind IS DISTINCT FROM NEW.kind THEN
      RAISE EXCEPTION 'La catégorie parente doit appartenir au même projet et avoir le même type.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM categories child
    WHERE child.parent_id = NEW.id
      AND (child.project_id IS DISTINCT FROM NEW.project_id OR child.kind IS DISTINCT FROM NEW.kind)
  ) THEN
    RAISE EXCEPTION 'Les catégories enfants doivent conserver le même projet et le même type.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS categories_parent_compatibility_check ON categories;
CREATE TRIGGER categories_parent_compatibility_check
  BEFORE INSERT OR UPDATE OF parent_id, project_id, kind ON categories
  FOR EACH ROW EXECUTE FUNCTION check_category_parent_compatibility();

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  operation_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  type TEXT NOT NULL CHECK (type IN ('RECETTE','DEPENSE','VIREMENT_INTERNE','REMBOURSEMENT','COTISATION','DON','SUBVENTION','AUTRE')),
  bank_label TEXT,
  description TEXT NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  supplier TEXT,
  bank_reference TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'NON_RAPPROCHE' CHECK (reconciliation_status IN ('NON_RAPPROCHE','RAPPROCHE','A_VERIFIER')),
  payment_method TEXT,
  comment TEXT,
  modified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  ocr_text TEXT,
  analysis JSONB,
  status TEXT NOT NULL DEFAULT 'A_VALIDER' CHECK (status IN ('ANALYSE_EN_COURS','A_VALIDER','VALIDE','ERREUR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  supplier TEXT,
  recipient TEXT,
  invoice_date DATE,
  total_ttc NUMERIC(14,2),
  total_ht NUMERIC(14,2),
  vat_amount NUMERIC(14,2),
  invoice_number TEXT,
  siret TEXT,
  payment_method TEXT,
  email TEXT,
  direction TEXT NOT NULL DEFAULT 'RECU',
  validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recipient TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'RECU';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_direction_check' AND conrelid = 'invoices'::regclass) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_direction_check CHECK (direction IN ('RECU', 'EMIS'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_allocations (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_allocations_invoice ON invoice_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_allocations_project ON invoice_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_allocations_category ON invoice_allocations(category_id);

CREATE OR REPLACE FUNCTION check_invoice_allocation() RETURNS trigger AS $$
DECLARE
  invoice_total NUMERIC(14,2);
  allocated_total NUMERIC(14,2);
  category_project_id UUID;
BEGIN
  SELECT ABS(total_ttc) INTO invoice_total FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE = '23503';
  END IF;
  IF invoice_total IS NULL OR invoice_total = 0 THEN
    RAISE EXCEPTION 'Une facture sans montant TTC ne peut pas être ventilée.' USING ERRCODE = '23514';
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    SELECT project_id INTO category_project_id FROM categories WHERE id = NEW.category_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Catégorie introuvable.' USING ERRCODE = '23503';
    END IF;
    IF category_project_id IS NOT NULL AND category_project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'La catégorie doit appartenir au projet de l''allocation.' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO allocated_total
  FROM invoice_allocations
  WHERE invoice_id = NEW.invoice_id AND id <> NEW.id;
  IF allocated_total + NEW.amount > invoice_total THEN
    RAISE EXCEPTION 'La somme des allocations dépasse le montant TTC de la facture.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoice_allocations_check ON invoice_allocations;
CREATE TRIGGER invoice_allocations_check
  BEFORE INSERT OR UPDATE OF invoice_id, project_id, category_id, amount ON invoice_allocations
  FOR EACH ROW EXECUTE FUNCTION check_invoice_allocation();

CREATE OR REPLACE FUNCTION check_invoice_total_against_allocations() RETURNS trigger AS $$
DECLARE
  allocated_total NUMERIC(14,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO allocated_total FROM invoice_allocations WHERE invoice_id = NEW.id;
  IF allocated_total > COALESCE(ABS(NEW.total_ttc), 0) THEN
    RAISE EXCEPTION 'Le montant TTC est inférieur aux allocations existantes.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoices_total_allocation_check ON invoices;
CREATE TRIGGER invoices_total_allocation_check
  BEFORE UPDATE OF total_ttc ON invoices
  FOR EACH ROW EXECUTE FUNCTION check_invoice_total_against_allocations();

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(operation_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_transaction ON documents(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Configuration de l'association (une seule ligne, identifiée par id = 1).
CREATE TABLE IF NOT EXISTS association_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  acronym TEXT,
  legal_form TEXT,
  legal_name TEXT,
  website TEXT,
  address TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'France',
  email TEXT,
  phone TEXT,
  siret TEXT,
  rna TEXT,
  fiscal_start_day SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_start_day BETWEEN 1 AND 31),
  fiscal_start_month SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_start_month BETWEEN 1 AND 12),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'France';
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS logo_path TEXT;
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS logo_mime TEXT;
INSERT INTO association_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  demo_mode BOOLEAN NOT NULL DEFAULT false,
  demo_seeded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id, demo_mode) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS association_members (
  id UUID PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  function TEXT,
  joined_on DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE association_members ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE association_members ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE association_members ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE association_members ADD COLUMN IF NOT EXISTS city TEXT;
CREATE INDEX IF NOT EXISTS idx_association_members_active ON association_members(active);

-- Le secret contient une enveloppe AES-GCM, jamais une valeur en clair.
CREATE TABLE IF NOT EXISTS ai_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  provider TEXT NOT NULL DEFAULT 'openai',
  auth_mode TEXT NOT NULL DEFAULT 'api_key' CHECK (auth_mode IN ('api_key', 'oauth', 'cli')),
  base_url TEXT,
  model TEXT,
  encrypted_secret TEXT,
  oauth_status TEXT NOT NULL DEFAULT 'non_configure',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE ai_settings ALTER COLUMN provider SET DEFAULT 'openai';
UPDATE ai_settings SET provider='openai',base_url='https://api.openai.com/v1',model=COALESCE(NULLIF(model,''),'gpt-5.6-luna')
WHERE provider='openai-compatible';

DO $$
BEGIN
  ALTER TABLE ai_settings DROP CONSTRAINT IF EXISTS ai_settings_auth_mode_check;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ai_settings'::regclass AND conname = 'ai_settings_auth_mode_check'
  ) THEN
    ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_auth_mode_check
      CHECK (auth_mode IN ('api_key', 'oauth', 'cli'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_oauth_flows (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_oauth_flows_expires_at ON ai_oauth_flows(expires_at);

-- OpenRouter et OpenAI disposent chacun d'un parcours OAuth officiel.
UPDATE ai_settings SET auth_mode='api_key',oauth_status='non_configure'
WHERE provider NOT IN ('openrouter','openai') AND auth_mode='oauth';
UPDATE ai_settings SET auth_mode='api_key'
WHERE provider NOT IN ('gemini') AND auth_mode='cli';

ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
UPDATE users SET role = 'BUREAU' WHERE role = 'MEMBRE';
DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND conname = 'users_role_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('ADMIN', 'TRESORIER', 'PRESIDENT', 'BUREAU', 'BENEVOLE'));
  END IF;
END $$;

-- Table de rapprochement multi-paiements / partiel entre factures et opérations bancaires
CREATE TABLE IF NOT EXISTS invoice_reconciliations (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  reconciled_amount NUMERIC(14,2) NOT NULL CHECK (reconciled_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_rec_invoice ON invoice_reconciliations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_rec_transaction ON invoice_reconciliations(transaction_id);

INSERT INTO invoice_reconciliations (id, invoice_id, transaction_id, reconciled_amount)
SELECT gen_random_uuid(), i.id, i.transaction_id, LEAST(ABS(COALESCE(i.total_ttc, 0)), ABS(COALESCE(t.amount, 0)))
FROM invoices i
JOIN transactions t ON t.id = i.transaction_id
WHERE i.transaction_id IS NOT NULL AND LEAST(ABS(COALESCE(i.total_ttc, 0)), ABS(COALESCE(t.amount, 0))) > 0
ON CONFLICT (invoice_id, transaction_id) DO NOTHING;
