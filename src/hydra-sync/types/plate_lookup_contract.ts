/**
 * src/hydra-sync/types/plate_lookup_contract.ts
 * Contratos de Dados para Consulta de Placas de Veículos (Spec 064).
 * Integração com APIBrasil e Cache Local SQLite.
 *
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

export interface ApiBrasilPlateResponse {
  readonly error?: boolean;
  readonly message?: string;
  readonly codigo?: number;
  readonly dados?: {
    readonly placa?: string;
    readonly marca?: string;
    readonly modelo?: string;
    readonly submodelo?: string;
    readonly versao?: string;
    readonly anoFabricacao?: number | string;
    readonly anoModelo?: number | string;
    readonly cor?: string;
    readonly combustivel?: string;
    readonly motor?: string;
    readonly cilindrada?: number | string;
    readonly potencia?: number | string;
    readonly chassi?: string;
    readonly municipio?: string;
    readonly uf?: string;
    readonly segmento?: string;
    readonly situacao?: string;
    readonly extra?: Record<string, unknown>;
  };
}

export interface VehiclePlateRecord {
  readonly placaLimpa: string;       // ex: 'FOE6I25'
  readonly placaFormatada: string;   // ex: 'FOE-6I25'
  readonly marca: string;            // ex: 'VOLKSWAGEN'
  readonly modelo: string;           // ex: 'GOLF'
  readonly modeloCompleto: string;   // ex: 'Volkswagen Golf 1.4 TSI'
  readonly submodelo?: string;       // ex: 'Comfortline'
  readonly versao?: string;          // ex: 'Comfortline 1.4 TSI'
  readonly anoFabricacao?: number;   // ex: 2014
  readonly anoModelo?: number;       // ex: 2015
  readonly cor?: string;             // ex: 'Branca'
  readonly combustivel?: string;     // ex: 'Gasolina'
  readonly motor?: string;           // ex: 'EA211 1.4'
  readonly cilindrada?: number;      // ex: 1395
  readonly potencia?: number;        // ex: 140
  readonly chassiMascarado?: string; // ex: '9BW***123'
  readonly municipio?: string;       // ex: 'São Paulo'
  readonly uf?: string;              // ex: 'SP'
  readonly segmento?: string;        // ex: 'AUTO'
  readonly situacao?: string;        // ex: 'CIRCULACAO'
  readonly origemDados: 'APIBRASIL' | 'ORDENS_SERVICO_REDE' | 'MANUAL';
  readonly rawPayloadJson: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface PlateLookupOptions {
  readonly timeoutMs?: number;
  readonly bearerToken?: string;
  readonly deviceToken?: string;
  readonly forceRefresh?: boolean;
}

export type PlateApiDiagnosticStatus =
  | 'CACHE_HIT'
  | 'ERP_HIT'
  | 'APIBRASIL_OK'
  | 'APIBRASIL_NO_ACTIVE_PLAN'
  | 'APIBRASIL_INSUFFICIENT_BALANCE'
  | 'APIBRASIL_NOT_FOUND'
  | 'APIBRASIL_TIMEOUT_OR_ERROR'
  | 'MANUAL_OVERRIDE';

export interface PlateResolutionAudit {
  readonly placa: string;
  readonly status: PlateApiDiagnosticStatus;
  readonly mensagemDiagnostico?: string;
  readonly saldoDisponivel?: string;
  readonly contaEmail?: string;
}

