import { Page, Locator } from 'playwright';

const DENYLIST = ['excluir', 'deletar', 'apagar', 'cancelar', 'pagar', 'remover', 'finalizar', 'enviar', 'confirmar exclusão'];
const EXPORTLIST = ['baixar', 'exportar', 'excel', 'csv', 'relatório', 'planilha'];

export async function isBlockedAction(text: string): Promise<{ blocked: boolean, requires_human_review: boolean }> {
  const lowerText = text.toLowerCase().trim();
  
  // Se for explicitamente algo de exportação/leitura, consideramos não bloqueado
  for (const exp of EXPORTLIST) {
     if (lowerText.includes(exp)) {
         // Cuidado com falso negativo: "baixar OS" vs "baixar relatório"
         if (lowerText.includes('os ') || lowerText.includes('título')) {
             return { blocked: true, requires_human_review: true };
         }
         return { blocked: false, requires_human_review: false };
     }
  }

  // Verifica denylist base
  for (const deny of DENYLIST) {
     if (lowerText.includes(deny)) {
         return { blocked: true, requires_human_review: false };
     }
  }

  return { blocked: false, requires_human_review: false };
}

export async function classifyPostBack(
  element: Locator, 
  target: string, 
  text: string
): Promise<'navigation_node' | 'in_page_control'> {
  // 1. Checa texto numérico ou botões padrões de paginação
  const lowerText = text.toLowerCase().trim();
  const isNumeric = /^\d+$/.test(lowerText);
  const isPagerText = ['próxima', 'anterior', 'primeira', 'última', 'next', 'prev', 'last', 'first', '...'].includes(lowerText);
  
  if (isNumeric || isPagerText) {
    return 'in_page_control';
  }

  // 2. Checa Target do PostBack por padrões ASP.NET GridView
  if (
    target.includes('Page$') || 
    target.includes('Sort$') || 
    target.includes('grd') || 
    target.includes('GridView') || 
    target.includes('Pager')
  ) {
    return 'in_page_control';
  }

  // 3. Checa contexto do DOM (se está dentro de uma table/grid)
  try {
     const isInTable = await element.evaluate((el) => {
        let parent = el.parentElement;
        while (parent) {
           if (parent.tagName === 'TABLE' || parent.className.toLowerCase().includes('grid') || parent.className.toLowerCase().includes('pager')) {
               return true;
           }
           parent = parent.parentElement;
        }
        return false;
     });
     if (isInTable) return 'in_page_control';
  } catch(e) {
     // Ignore se falhar a avaliação, safe-fail assumindo que pode ser in_page_control
     return 'in_page_control';
  }

  // Fail-safe: Se passou por tudo e parece navegação comum
  return 'navigation_node';
}

export async function extractTableColumns(page: Page): Promise<string[]> {
  const columns: string[] = [];
  try {
    const ths = await page.locator('table th').allTextContents();
    for (const th of ths) {
       const clean = th.trim().replace(/\n/g, ' ');
       if (clean) columns.push(clean);
    }
  } catch (e) {
    //
  }
  return [...new Set(columns)];
}
