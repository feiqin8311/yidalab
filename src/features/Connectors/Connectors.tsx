import { RECOMMENDED_SKILLS, RecommendedSkillType } from '@lobechat/const';
import { useEffect, useState } from 'react';

import { useToolStore } from '@/store/tool';

import ConnectorDetail from './ConnectorDetail';
import ConnectorList from './ConnectorList';

const RECOMMENDED_BUILTIN_IDS = RECOMMENDED_SKILLS.filter(
  (s) => s.type === RecommendedSkillType.Builtin,
).map((s) => s.id);

const Connectors = () => {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const isInit = useToolStore((s) => s.isConnectorsInit);
  const connectors = useToolStore((s) => s.connectors);
  const uninstalledBuiltinTools = useToolStore((s) => s.uninstalledBuiltinTools);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      await fetchConnectors();
      if (cancelled) return;

      // Recommended builtins are installed by default but only become connector
      // rows after syncBuiltinTool — open Skills detail or land here. Ensure
      // missing rows (e.g. lobe-dingpan) show up on the connectors page.
      const current = useToolStore.getState().connectors;
      const uninstalled = new Set(useToolStore.getState().uninstalledBuiltinTools ?? []);
      const existing = new Set(current.map((c) => c.identifier));

      for (const id of RECOMMENDED_BUILTIN_IDS) {
        if (uninstalled.has(id) || existing.has(id)) continue;
        try {
          await syncBuiltinTool(id);
        } catch (error) {
          console.error(`[Connectors] failed to bootstrap builtin ${id}`, error);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fetchConnectors, syncBuiltinTool, uninstalledBuiltinTools]);

  // Auto-select first connector
  useEffect(() => {
    if (!selectedId && connectors.length > 0) {
      setSelectedId(connectors[0].id);
    }
  }, [connectors, selectedId]);

  if (!isInit) return null;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div
        style={{
          borderRight: '1px solid var(--lobe-colors-border)',
          minWidth: 220,
          overflowY: 'auto',
          width: 220,
        }}
      >
        <ConnectorList selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {selectedId && <ConnectorDetail connectorId={selectedId} />}
      </div>
    </div>
  );
};

export default Connectors;
