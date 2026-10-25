import { useRef } from 'react';
import './Tabs.css';

/**
 * Accessible tabs (WAI-ARIA tabs pattern). Arrow keys, Home and End move between tabs,
 * and selection follows focus. Only the selected tab is in the Tab order.
 *
 *   <Tabs label="Trip sections" idPrefix="trip" tabs={[{ id: 'plan', label: 'Plan' }, …]}
 *         selected={tab} onSelect={setTab} />
 *   <TabPanel idPrefix="trip" id="plan" selected={tab}>…</TabPanel>
 */
const tabId = (prefix, id) => `${prefix}-tab-${id}`;
const panelId = (prefix, id) => `${prefix}-panel-${id}`;

export default function Tabs({ label, idPrefix, tabs, selected, onSelect }) {
  const refs = useRef({});

  function handleKeyDown(event) {
    const index = tabs.findIndex((tab) => tab.id === selected);
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length]; // arrows wrap around
    onSelect(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="tabs" onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const isSelected = tab.id === selected;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={isSelected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={isSelected ? 0 : -1}
            className="tabs__tab"
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, selected, children }) {
  return (
    <div
      role="tabpanel"
      id={panelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      hidden={id !== selected}
      tabIndex={0}
      className="tabs__panel"
    >
      {children}
    </div>
  );
}
