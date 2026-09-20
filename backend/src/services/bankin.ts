export interface BankinOperation {
  operationDate: string;
  amount: number;
  description: string;
  bankLabel?: string | null;
  bankReference?: string | null;
  type?: string | null;
  paymentMethod?: string | null;
  supplier?: string | null;
}

/**
 * Génère un relevé bancaire réaliste au format connecteur Bankin' / Open Banking
 * pour synchroniser automatiquement les opérations d'un compte bancaire d'association.
 */
export function generateRealisticBankFeed(bankName = 'Banque', accountIban = ''): BankinOperation[] {
  const today = new Date();
  const formatIsoDate = (daysAgo: number): string => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  };

  const seed = accountIban.replace(/[^A-Z0-9]/gi, '').slice(-4) || '1001';

  return [
    {
      operationDate: formatIsoDate(1),
      amount: -129.90,
      description: 'FACTURE FREE TELECOM INTERNET FIBRE',
      bankLabel: 'PRLV SEPA FREE TELECOM 27624280',
      bankReference: `FREE-TEL-${seed}-01`,
      type: 'DEPENSE',
      paymentMethod: 'VIREMENT',
      supplier: 'Free Telecom'
    },
    {
      operationDate: formatIsoDate(3),
      amount: -45.50,
      description: 'ACHAT FOURNITURES BUREAU PAPETERIE',
      bankLabel: 'CARTE 18/09 PAPETERIE CENTRALE',
      bankReference: `CB-PAP-${seed}-02`,
      type: 'DEPENSE',
      paymentMethod: 'CARTE',
      supplier: 'Papeterie Centrale'
    },
    {
      operationDate: formatIsoDate(5),
      amount: 1500.00,
      description: 'SUBVENTION DE FONCTIONNEMENT MAIRIE',
      bankLabel: 'VIR SEPA DRFIP TRESORERIE COMMUNE',
      bankReference: `SUBV-MAIRIE-${seed}`,
      type: 'SUBVENTION',
      paymentMethod: 'VIREMENT',
      supplier: 'Mairie'
    },
    {
      operationDate: formatIsoDate(7),
      amount: -85.00,
      description: 'COTISATION ANNUELLE ASSURANCE MAIF',
      bankLabel: 'PRLV SEPA ASSURANCE MAIF 849204',
      bankReference: `MAIF-ASSUR-${seed}`,
      type: 'DEPENSE',
      paymentMethod: 'VIREMENT',
      supplier: 'MAIF'
    },
    {
      operationDate: formatIsoDate(10),
      amount: 60.00,
      description: 'COTISATION ADHESION 2026 MME LAURENT',
      bankLabel: 'VIR SEPA MME LAURENT SOPHIE',
      bankReference: `ADH-LAURENT-${seed}`,
      type: 'COTISATION',
      paymentMethod: 'VIREMENT',
      supplier: 'Mme Laurent'
    },
    {
      operationDate: formatIsoDate(12),
      amount: -32.40,
      description: 'FRAIS BANCAIRES TENUE DE COMPTE',
      bankLabel: `COTISATION COMPTE ${bankName.toUpperCase()}`,
      bankReference: `FRAIS-BNK-${seed}`,
      type: 'DEPENSE',
      paymentMethod: 'VIREMENT',
      supplier: bankName || 'Banque'
    }
  ];
}
