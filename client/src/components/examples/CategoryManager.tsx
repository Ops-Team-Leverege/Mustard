import CategoryManager from '../CategoryManager';

export default function CategoryManagerExample() {
  const categories = [
    { 
      id: '1', 
      name: 'Analytics', 
      description: 'Reporting, dashboards, data visualization, and business intelligence features',
      usageCount: 12 
    },
    { 
      id: '2', 
      name: 'Mobile', 
      description: 'Mobile app features, offline mode, and mobile-specific functionality',
      usageCount: 8 
    },
    { 
      id: '3', 
      name: 'Integration', 
      description: 'Third-party integrations, APIs, webhooks, and data sync capabilities',
      usageCount: 15 
    },
    { 
      id: '4', 
      name: 'Security', 
      description: 'Authentication, authorization, data encryption, and security compliance features',
      usageCount: 6 
    },
  ];

  return (
    <div className="p-6">
      <CategoryManager categories={categories} />
    </div>
  );
}
