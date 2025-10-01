import { useState } from "react";
import CategoryManager, { Category } from "@/components/CategoryManager";

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([
    { id: '1', name: 'Analytics', usageCount: 12 },
    { id: '2', name: 'Mobile', usageCount: 8 },
    { id: '3', name: 'Integration', usageCount: 15 },
    { id: '4', name: 'Security', usageCount: 6 },
  ]);

  const handleAdd = (name: string) => {
    const newCategory: Category = {
      id: Date.now().toString(),
      name,
      usageCount: 0,
    };
    setCategories([...categories, newCategory]);
  };

  const handleEdit = (id: string, name: string) => {
    setCategories(categories.map(cat => 
      cat.id === id ? { ...cat, name } : cat
    ));
  };

  const handleDelete = (id: string) => {
    setCategories(categories.filter(cat => cat.id !== id));
  };

  return (
    <div className="container mx-auto py-8 px-6">
      <CategoryManager
        categories={categories}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    </div>
  );
}
