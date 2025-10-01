import CategoryManager from '../CategoryManager';

export default function CategoryManagerExample() {
  const categories = [
    { id: '1', name: 'Analytics', usageCount: 12 },
    { id: '2', name: 'Mobile', usageCount: 8 },
    { id: '3', name: 'Integration', usageCount: 15 },
    { id: '4', name: 'Security', usageCount: 6 },
  ];

  return (
    <div className="p-6">
      <CategoryManager categories={categories} />
    </div>
  );
}
