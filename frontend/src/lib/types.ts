export type PageId = 'dashboard' | 'accounts' | 'transactions' | 'invoices' | 'reconciliation' | 'categories' | 'projects' | 'reports' | 'configuration';
export type UserRole = 'ADMIN' | 'TRESORIER' | 'PRESIDENT' | 'BUREAU' | 'BENEVOLE';

export interface User {
  id?: string | number;
  name?: string;
  email: string;
  role: UserRole;
  active?: boolean;
}

export interface AuthStatus {
  setupRequired: boolean;
  demoMode: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface InitialSetupPayload {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}

export interface AssociationConfig {
  name?: string;
  legalName?: string;
  acronym?: string;
  rna?: string;
  siret?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  fiscalYearStartDay?: number;
  fiscalYearStartMonth?: number;
  hasLogo?: boolean;
  logoUrl?: string | null;
  [key: string]: unknown;
}

export interface MemberConfig {
  id: string | number;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  role?: string;
  active?: boolean;
  [key: string]: unknown;
}

export interface AiConfig {
  enabled?: boolean;
  configured?: boolean;
  provider?: string;
  authMode?: 'oauth' | 'api_key' | 'cli';
  baseUrl?: string;
  model?: string;
  [key: string]: unknown;
}

export interface DatabaseConfig {
  status?: string;
  connected?: boolean;
  host?: string;
  port?: number;
  database?: string;
  name?: string;
  dialect?: string;
  version?: string;
  [key: string]: unknown;
}

export interface ConfigData {
  association: AssociationConfig;
  members: MemberConfig[];
  memberCompliance: { activeCount: number; minimum: number; compliant: boolean };
  users: User[];
  ai: AiConfig;
  database: DatabaseConfig;
}

export interface Account {
  id: string | number;
  name: string;
  type?: string;
  balance?: number;
  initialBalance?: number;
  initial_balance?: number;
  currency?: string;
  bank?: string;
  bankName?: string;
  bank_name?: string;
  bankAddress?: string;
  bank_address?: string;
  managerName?: string;
  manager_name?: string;
  iban?: string;
  rib?: string;
  contractFilename?: string;
  contract_filename?: string;
  contractPath?: string;
  contract_path?: string;
  contractMime?: string;
  contract_mime?: string;
  hasContract?: boolean;
  bankinConnected?: boolean;
  bankin_connected?: boolean;
  bankinAccountId?: string;
  bankin_account_id?: string;
  lastSyncedAt?: string;
  last_synced_at?: string;
  active?: boolean;
}

export interface Category {
  id: string | number;
  name: string;
  kind?: 'RECETTE' | 'DEPENSE' | 'MIXTE';
  color?: string;
  parent_id?: string | null;
  parentId?: string | null;
  project_id?: string | null;
  projectId?: string | null;
  project_name?: string | null;
}

export interface Project {
  id: string | number;
  name: string;
  description?: string;
  budget?: number;
  active?: boolean;
  parent_id?: string | null;
  parentId?: string | null;
  status?: 'IDEE' | 'MONTAGE' | 'EN_COURS' | 'TERMINE' | 'AVORTE';
  status_reason?: string | null;
  statusReason?: string | null;
  income?: number;
  expense?: number;
}

export interface InvoiceAllocation {
  id?: string | number;
  project_id?: string | null;
  projectId?: string | null;
  category_id?: string | null;
  categoryId?: string | null;
  project_name?: string | null;
  category_name?: string | null;
  amount: number;
}

export interface Transaction {
  id: string | number;
  label?: string;
  description?: string;
  date: string;
  amount: number;
  direction?: 'income' | 'expense' | 'credit' | 'debit';
  type?: string;
  bank_label?: string | null;
  bankLabel?: string | null;
  bank_reference?: string | null;
  bankReference?: string | null;
  payment_method?: string | null;
  paymentMethod?: string | null;
  category?: Category | string;
  category_name?: string | null;
  categoryName?: string | null;
  account?: Account | string;
  account_name?: string | null;
  accountName?: string | null;
  project?: Project | string;
  project_name?: string | null;
  projectName?: string | null;
  totalAmount?: number;
  reconciledAmount?: number;
  remainingAmount?: number;
  reconciliationPercent?: number;
}

export interface Invoice {
  id: string | number;
  document_id?: string;
  documentId?: string;
  mime_type?: string;
  original_name?: string;
  number?: string;
  supplier?: string;
  recipient?: string;
  date?: string;
  total?: number;
  totalTtc?: number;
  status?: string;
  direction?: string;
  invoice_direction?: string;
  type?: string;
  is_reconciled?: boolean;
  reconciled?: boolean;
  isReconciled?: boolean;
  transaction_id?: string | null;
  transactionId?: string | null;
  allocated_amount?: number;
  allocatedAmount?: number;
  remaining_amount?: number;
  remainingAmount?: number;
  totalAmount?: number;
  reconciledAmount?: number;
  reconciliationPercent?: number;
  remainingAllocationAmount?: number;
  allocations?: InvoiceAllocation[];
}

export interface DashboardData {
  balance?: number;
  totalBalance?: number;
  income?: number;
  expenses?: number;
  pendingInvoices?: number;
  recentTransactions?: Transaction[];
  monthlyData?: Array<{ label?: string; month?: string; income?: number; expenses?: number }>;
}

export interface AnalysisField<T = string | number> {
  value?: T;
  confidence?: number;
  uncertain?: boolean;
}

export interface CaptureAnalysis {
  type?: string | AnalysisField;
  direction?: string | AnalysisField;
  supplier?: string | AnalysisField;
  recipient?: string | AnalysisField;
  number?: string | AnalysisField;
  date?: string | AnalysisField;
  subtotal?: number | AnalysisField<number>;
  tax?: number | AnalysisField<number>;
  total?: number | AnalysisField<number>;
  categoryId?: string | AnalysisField;
  projectId?: string | AnalysisField;
  confidence?: number;
  previewUrl?: string;
  [key: string]: unknown;
}

export interface CapturedDocument {
  id: string | number;
  previewUrl?: string;
  url?: string;
  filename?: string;
  status?: string;
}

export interface ReconciledPair {
  reconciliation_id?: string;
  reconciled_amount?: number;
  invoice_id: string;
  invoice_number?: string;
  invoice_date?: string;
  invoice_supplier?: string;
  invoice_recipient?: string;
  direction?: string;
  invoice_direction?: string;
  invoice_total_ttc?: number;
  invoice_reconciled_total?: number;
  invoice_reconciliation_percent?: number;
  document_id?: string;
  document_name?: string;
  document_mime_type?: string;
  transaction_id: string;
  transaction_date: string;
  transaction_amount: number;
  transaction_description: string;
  transaction_bank_label?: string;
  transaction_payment_method?: string;
  transaction_reconciled_total?: number;
  transaction_reconciliation_percent?: number;
  account_name?: string;
  reconciled_at?: string;
}

export interface ReconciliationData {
  unreconciledTransactions: Transaction[];
  unreconciledInvoices: Invoice[];
  reconciledPairs: ReconciledPair[];
}
