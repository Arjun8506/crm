// Reusable "form pack" starting points. Each is plain data; the create endpoint materialises it as fields.
const opts = (...v) => v.map((x) => ({ value: x.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: x }));

export const TEMPLATES = [
  {
    id: 'companies', name: 'Companies', category: 'Sales', description: 'Organizations you sell to or work with.',
    fields: [
      { key: 'name', label: 'Company name', type: 'text', required: true, unique: true },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'industry', label: 'Industry', type: 'dropdown', options: opts('Technology', 'Manufacturing', 'Healthcare', 'Finance', 'Retail', 'Other') },
      { key: 'employees', label: 'Employees', type: 'integer', min: 0 },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    id: 'contacts', name: 'Contacts', category: 'Sales', description: 'People: leads, customers and partners.',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', unique: true },
      { key: 'phone', label: 'Phone', type: 'phone' },
      { key: 'status', label: 'Status', type: 'dropdown', options: opts('Lead', 'Prospect', 'Customer', 'Churned'), defaultValue: 'lead' },
      { key: 'tags', label: 'Tags', type: 'multiselect', options: opts('VIP', 'Newsletter', 'Partner', 'Event') },
      { key: 'last_contacted', label: 'Last contacted', type: 'date' },
    ],
  },
  {
    id: 'deals', name: 'Deals', category: 'Sales', description: 'Opportunities and their value.',
    fields: [
      { key: 'title', label: 'Deal title', type: 'text', required: true },
      { key: 'value', label: 'Value', type: 'decimal', min: 0 },
      { key: 'stage', label: 'Stage', type: 'dropdown', options: opts('Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'), defaultValue: 'qualified' },
      { key: 'close_date', label: 'Expected close', type: 'date' },
      { key: 'won', label: 'Won', type: 'boolean' },
    ],
  },
  {
    id: 'tickets', name: 'Support tickets', category: 'Support', description: 'Customer issues and their resolution.',
    fields: [
      { key: 'subject', label: 'Subject', type: 'text', required: true },
      { key: 'priority', label: 'Priority', type: 'dropdown', options: opts('Low', 'Medium', 'High', 'Urgent'), defaultValue: 'medium' },
      { key: 'status', label: 'Status', type: 'dropdown', options: opts('Open', 'In progress', 'Resolved'), defaultValue: 'open' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'opened_at', label: 'Opened at', type: 'datetime' },
    ],
  },
];
