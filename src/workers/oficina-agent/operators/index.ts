import { Page } from 'playwright';
import { BusinessOperator, WorkflowResult } from './types.js';
import { faturamento_por_periodo } from './financeiro.js';
import { os_handler } from './os.js';

const registry: Record<string, BusinessOperator> = {
    'financeiro.faturamento_rede': faturamento_por_periodo,
    'financeiro.faturamento_por_periodo': faturamento_por_periodo,
    'os.status_snapshot': os_handler,
    'os.fluxo_diario': os_handler,
    'os.listagem_detalhada': os_handler,
    'os.mecanico_resumo': os_handler
};

export async function executeBusinessWorkflow(page: Page, params: any): Promise<WorkflowResult> {
    const workflowId = params.workflow_id;
    if (!workflowId) {
        throw new Error("Parâmetro 'workflow_id' é obrigatório para execute_workflow.");
    }

    const operator = registry[workflowId];
    if (!operator) {
        throw new Error(`Nenhum operador registrado para o workflow_id: ${workflowId}`);
    }

    console.log(`[Operators] Delegando execução para o operador do workflow: ${workflowId}`);
    return await operator(page, params);
}
