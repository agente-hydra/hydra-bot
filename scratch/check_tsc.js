const fs = require('fs');
const { execSync } = require('child_process');

const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf-8'));
// Keep all source files and active gate suites
tsconfig.include = [
  "src/hydra-sync/types/conversation_context_contract.ts",
  "src/hydra-sync/types/semantic_contract.ts",
  "src/hydra-sync/conversation_semantic_resolver.ts",
  "src/hydra-sync/os_situation_composer.ts",
  "src/hydra-sync/real_analysis_repository.ts",
  "src/hydra-sync/operational_data_repository.ts",
  "src/hydra-sync/conversation_source_adapter.ts",
  "src/hydra-sync/summary_evidence_adapter.ts",
  "src/hydra-sync/conversation_reader_safe.ts",
  "src/hydra-sync/conversation_cache_manager.ts",
  "src/hydra-sync/hybrid_os_coordinator.ts",
  "src/hydra-sync/ontology_catalog.ts",
  "src/hydra-sync/data_dictionary.ts",
  "src/hydra-sync/evidence_repository.ts",
  "src/hydra-sync/evidence_policy_manager.ts",
  "src/hydra-sync/case_current_position.ts",
  "src/hydra-sync/case_graph_projection.ts",
  "src/hydra-sync/case_memory_reader.ts",
  "src/hydra-sync/analysis_memory_writer.ts",
  "src/hydra-sync/analysis_projection_outbox.ts",
  "src/hydra-sync/semantic_glossary.ts",
  "src/hydra-sync/intent_rewriter.ts",
  "src/hydra-sync/query_builder_safe.ts",
  "src/hydra-sync/semantic_compiler.ts",
  "src/hydra-sync/semantic_executor.ts",
  "src/hydra-sync/balloon_composer.ts",
  "src/hydra-sync/tests/test_case_graph_gates.ts",
  "src/hydra-sync/tests/test_executor1_case_content.ts",
  "src/hydra-sync/tests/test_executor2_writer_history.ts",
  "src/hydra-sync/tests/test_executor3_graph_projection.ts"
];

fs.writeFileSync('tsconfig.clean.json', JSON.stringify(tsconfig, null, 2), 'utf-8');

try {
  console.log('Running tsc with active sources and tests...');
  const res = execSync('npx tsc -p tsconfig.clean.json --noEmit', { encoding: 'utf-8' });
  console.log('✓ TSC RESULT: SUCCESS (Exit Code 0)');
} catch (e) {
  console.error('TSC Failed:', e.stdout || e.message);
}
