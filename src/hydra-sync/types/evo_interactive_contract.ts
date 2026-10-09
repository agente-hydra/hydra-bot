/**
 * Hydra — Contrato da Evolution API v2.3.7 para Mensagens Interativas de Lista e Botões
 * Spec: hydra-evo-interactive-os
 */

export type AllowedOSModule = 
  | 'servicos' 
  | 'pecas' 
  | 'pagamentos' 
  | 'documentos' 
  | 'historico';

export const ALLOWED_OS_MODULES: readonly AllowedOSModule[] = [
  'servicos',
  'pecas',
  'pagamentos',
  'documentos',
  'historico'
] as const;

export function isAllowedOSModule(val: string): val is AllowedOSModule {
  return (ALLOWED_OS_MODULES as readonly string[]).includes(val.toLowerCase());
}

export const OS_MODULE_ROW_ID_REGEX = /^os_(\d{1,8})_(servicos|pecas|pagamentos|documentos|historico)$/i;

export function translateInteractiveRowToPrompt(rowId: string): string {
  const osMatch = String(rowId || '').trim().match(OS_MODULE_ROW_ID_REGEX);
  if (!osMatch) return rowId;

  const osId = osMatch[1];
  const mod = osMatch[2].toLowerCase() as AllowedOSModule;

  switch (mod) {
    case 'servicos':
      return `Quais são os serviços discriminados da OS #${osId}?`;
    case 'pecas':
      return `Quais são as peças e materiais aplicados na OS #${osId}?`;
    case 'pagamentos':
      return `Quais são as formas de pagamento e parcelas da OS #${osId}?`;
    case 'documentos':
      return `Mostre as vistorias, checklists e documentos da OS #${osId}.`;
    case 'historico':
      return `Qual o histórico de atendimento, conversas e tratativas da OS #${osId}?`;
    default:
      return `Detalhe a Ordem de Serviço #${osId}.`;
  }
}

export interface EvoListRow {
  /** Título principal visível na linha (ex: "1. Serviços") */
  readonly title: string;
  /** Descrição complementar (ex: "7 itens discriminados · R$ 1.850,90") */
  readonly description?: string;
  /** Identificador único devolvido no webhook (ex: "os_18503_servicos") */
  readonly rowId: string;
}

export interface EvoListSection {
  /** Título do grupo de opções (ex: "Módulos da OS #18503") */
  readonly title: string;
  /** Linhas selecionáveis na seção */
  readonly rows: readonly EvoListRow[];
}

export interface EvoListPayload {
  /** Telefone com DDI e DDD (ex: "5511996242812") */
  readonly number: string;
  /** Título exibido no topo da lista */
  readonly title: string;
  /** Texto descritivo acima do botão */
  readonly description: string;
  /** Texto do botão de abertura da lista nativa */
  readonly buttonText: string;
  /** Texto de rodapé obrigatório na Evolution API v2 */
  readonly footerText: string;
  /** Seções com suas respectivas linhas */
  readonly sections: readonly EvoListSection[];
}
