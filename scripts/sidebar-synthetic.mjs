// Synthetic bookmarks and tabs for the Sidebar feasibility harness. Invented names only; never
// real browser data.

export const SYNTHETIC = {
  bar: [
    { title: "Inbox — Mail", path: "/mail" },
    { title: "Calendar", path: "/calendar" },
    { title: "Notes", path: "/notes" },
    { title: "Everyday", children: [
      { title: "Team chat", path: "/chat" },
      { title: "Project board — Q4 delivery plan and open questions for the steering group", path: "/board" },
      { title: "Docs home", path: "/docs" },
      { title: "Time tracking", path: "/time" },
      { title: "Banking", path: "/bank" },
    ] },
    { title: "Clients", children: [
      { title: "Northwind", children: [
        { title: "Northwind — project brief", path: "/northwind/brief" },
        { title: "Northwind — signed engagement letter (final, v3)", path: "/northwind/contract" },
      ] },
      { title: "Contoso", children: [
        { title: "Contoso wiki", path: "/contoso/wiki" },
        { title: "Contoso tickets", path: "/contoso/tickets" },
      ] },
      { title: "Client list", path: "/clients" },
    ] },
    { title: "Reading", children: [
      { title: "Designing calm interfaces for tools people use all day", path: "/reading/calm" },
      { title: "A field guide to keyboard navigation in dense lists", path: "/reading/keyboard" },
      { title: "Why small screens punish fixed chrome", path: "/reading/small-screens" },
    ] },
    { title: "Tools", children: [
      { title: "DNS settings", path: "/dns" },
      { title: "Analytics", path: "/analytics" },
      { title: "Status page", path: "/status" },
    ] },
  ],
  other: [
    { title: "Recipes", path: "/recipes" },
    { title: "Travel checklist", path: "/travel" },
  ],
  // Tabs per synthetic window. `active` marks the selected tab; `audible` plays a quiet tone.
  windows: {
    human: [
      { title: "Inbox — Mail", path: "/mail" },
      { title: "Project board — Q4 delivery plan and open questions for the steering group", path: "/board", active: true },
      { title: "Designing calm interfaces for tools people use all day", path: "/reading/calm" },
      { title: "Spec — compact sidebar", path: "/docs/spec" },
      { title: "Focus music", path: "/music", audible: true },
      { title: "Northwind — project brief", path: "/northwind/brief" },
      { title: "Calendar", path: "/calendar" },
    ],
    ai: [
      { title: "Research notes — agent run", path: "/agent/research", active: true },
      { title: "Run log", path: "/agent/run-log" },
      { title: "Docs home", path: "/docs" },
    ],
  },
};
