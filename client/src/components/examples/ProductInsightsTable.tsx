import ProductInsightsTable from '../ProductInsightsTable';

export default function ProductInsightsTableExample() {
  const insights = [
    {
      id: '1',
      feature: 'Real-time Analytics Dashboard',
      context: 'Need to monitor fleet performance in real-time',
      quote: 'We absolutely need to see our vehicles in real-time, not 5 minutes delayed',
      company: 'LogiTech Solutions',
      category: 'Analytics'
    },
    {
      id: '2',
      feature: 'Mobile App Offline Mode',
      context: 'Drivers work in areas with poor connectivity',
      quote: 'Our drivers are often in remote areas with no signal',
      company: 'TransGlobal',
      category: 'Mobile'
    },
    {
      id: '3',
      feature: 'Custom Alert Rules',
      context: 'Want to define custom thresholds for temperature monitoring',
      quote: 'Each product line has different temperature requirements',
      company: 'FreshFoods Inc',
      category: 'NEW'
    },
  ];

  const categories = ['Analytics', 'Mobile', 'Integration', 'Security'];

  return (
    <div className="p-6">
      <ProductInsightsTable insights={insights} categories={categories} />
    </div>
  );
}
