import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  usageCount: number;
}

interface CategoryManagerProps {
  categories: Category[];
  onAdd?: (name: string, description?: string) => void;
  onEdit?: (id: string, name: string, description?: string) => void;
  onDelete?: (id: string) => void;
}

export default function CategoryManager({ categories, onAdd, onEdit, onDelete }: CategoryManagerProps) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const handleAdd = () => {
    if (newCategoryName.trim()) {
      console.log('Adding category:', newCategoryName, newCategoryDescription);
      onAdd?.(newCategoryName, newCategoryDescription || undefined);
      setNewCategoryName('');
      setNewCategoryDescription('');
      setIsAddOpen(false);
    }
  };

  const handleEdit = () => {
    if (editingId && editName.trim()) {
      console.log('Editing category:', editingId, editName, editDescription);
      onEdit?.(editingId, editName, editDescription || undefined);
      setEditingId(null);
      setEditName('');
      setEditDescription('');
    }
  };

  const handleDelete = (id: string) => {
    console.log('Deleting category:', id);
    onDelete?.(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Feature Categories</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage categories for organizing product insights
          </p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-category">
              <Plus className="w-4 h-4 mr-2" />
              Add Category
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Category</DialogTitle>
              <DialogDescription>
                Create a new category for organizing product feature insights
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="categoryName">Category Name</Label>
                <Input
                  id="categoryName"
                  data-testid="input-category-name"
                  placeholder="e.g., Analytics, Mobile, Integration"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAdd()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="categoryDescription">Description (Optional)</Label>
                <Textarea
                  id="categoryDescription"
                  data-testid="input-category-description"
                  placeholder="Describe what features belong in this category to help with AI matching..."
                  value={newCategoryDescription}
                  onChange={(e) => setNewCategoryDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} data-testid="button-save-category">
                Add Category
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {categories.length === 0 ? (
          <Card className="col-span-2">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No categories yet. Add your first category to get started.</p>
            </CardContent>
          </Card>
        ) : (
          categories.map((category) => (
            <Card key={category.id} data-testid={`card-category-${category.id}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <div className="flex-1">
                  <CardTitle className="text-lg">{category.name}</CardTitle>
                  <CardDescription className="mt-1">
                    {category.description || 'No description'}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Dialog
                    open={editingId === category.id}
                    onOpenChange={(open) => {
                      if (open) {
                        setEditingId(category.id);
                        setEditName(category.name);
                        setEditDescription(category.description || '');
                      } else {
                        setEditingId(null);
                        setEditName('');
                        setEditDescription('');
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-edit-${category.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Edit Category</DialogTitle>
                        <DialogDescription>
                          Update the category name and description
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="editCategoryName">Category Name</Label>
                          <Input
                            id="editCategoryName"
                            data-testid="input-edit-category-name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleEdit()}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="editCategoryDescription">Description (Optional)</Label>
                          <Textarea
                            id="editCategoryDescription"
                            data-testid="input-edit-category-description"
                            placeholder="Describe what features belong in this category..."
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                        <Button onClick={handleEdit} data-testid="button-update-category">
                          Update
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(category.id)}
                    data-testid={`button-delete-${category.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <Badge variant="secondary" className="font-normal">
                  {category.usageCount} {category.usageCount === 1 ? 'insight' : 'insights'}
                </Badge>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
