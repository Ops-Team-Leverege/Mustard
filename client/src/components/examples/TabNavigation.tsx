import TabNavigation from '../TabNavigation';
import { Router } from "wouter";

export default function TabNavigationExample() {
  const tabs = [
    { id: 'insights', label: 'Product Insights', path: '/insights' },
    { id: 'qa', label: 'Q&A Database', path: '/qa' },
    { id: 'categories', label: 'Manage Categories', path: '/categories' },
  ];

  return (
    <Router>
      <TabNavigation tabs={tabs} />
    </Router>
  );
}
