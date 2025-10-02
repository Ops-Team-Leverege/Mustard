import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Pencil, Trash2, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ProductInsight {
  id: string;
  feature: string;
  context: string;
  quote: string;
  company: string;
  category: string;
  categoryId?: string | null;
}

export interface Category {
  id: string;
  name: string;
}

interface ProductInsightsTableProps {
  insights: ProductInsight[];
  categories?: Category[];
  defaultCompany?: string;
}

export default function ProductInsightsTable({ insights, categories = [], defaultCompany }: ProductInsightsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingInsight, setEditingInsight] = useState<ProductInsight | null>(null);
  const [editForm, setEditForm] = useState({ feature: '', context: '', quote: '', categoryId: null as string | null });
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ feature: '', context: '', quote: '', company: defaultCompany || '', categoryId: null as string | null });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/insights/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      toast({
        title: "Success",
        description: "Insight deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete insight",
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, feature, context, quote, categoryId }: { id: string; feature: string; context: string; quote: string; categoryId: string | null }) => {
      // Update the insight
      const res = await apiRequest('PATCH', `/api/insights/${id}`, { feature, context, quote });
      if (!res.ok) {
        throw new Error('Failed to update insight');
      }
      
      // Update category separately
      const catRes = await apiRequest('PATCH', `/api/insights/${id}/category`, { categoryId });
      if (!catRes.ok) {
        throw new Error('Failed to update category');
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      setEditingInsight(null);
      toast({
        title: "Success",
        description: "Insight updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update insight",
        variant: "destructive",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ feature, context, quote, company, categoryId }: { feature: string; context: string; quote: string; company: string; categoryId: string | null }) => {
      const res = await apiRequest('POST', '/api/insights', { feature, context, quote, company, categoryId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      setIsAddDialogOpen(false);
      setAddForm({ feature: '', context: '', quote: '', company: defaultCompany || '', categoryId: null });
      toast({
        title: "Success",
        description: "Insight added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add insight",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (insight: ProductInsight) => {
    setEditingInsight(insight);
    setEditForm({ 
      feature: insight.feature, 
      context: insight.context, 
      quote: insight.quote,
      categoryId: insight.categoryId || null
    });
  };

  const handleSaveEdit = () => {
    if (editingInsight) {
      editMutation.mutate({ id: editingInsight.id, ...editForm });
    }
  };

  const handleAdd = () => {
    if (!addForm.feature || !addForm.context || !addForm.quote || !addForm.company) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(addForm);
  };

  const handleOpenAddDialog = () => {
    setAddForm({ feature: '', context: '', quote: '', company: defaultCompany || '', categoryId: null });
    setIsAddDialogOpen(true);
  };

  const filteredInsights = insights.filter(insight => {
    const matchesSearch = 
      insight.feature.toLowerCase().includes(searchQuery.toLowerCase()) ||
      insight.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      insight.context.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || 
      (categoryFilter === 'NEW' && (!insight.categoryId || insight.category === 'NEW')) ||
      insight.categoryId === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  const totalPages = Math.ceil(filteredInsights.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedInsights = filteredInsights.slice(startIndex, endIndex);

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleCategoryFilterChange = (value: string) => {
    setCategoryFilter(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap items-center justify-between">
        <div className="flex gap-4 flex-wrap flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search features or companies..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              data-testid="input-search-insights"
            />
          </div>
          <Combobox
            options={[
              { value: 'all', label: 'All categories' },
              { value: 'NEW', label: 'NEW' },
              ...categories.map(cat => ({ value: cat.id, label: cat.name }))
            ]}
            value={categoryFilter}
            onValueChange={handleCategoryFilterChange}
            placeholder="All categories"
            searchPlaceholder="Search categories..."
            emptyText="No category found."
            className="w-[200px]"
            testId="select-category-filter"
          />
        </div>
        <Button onClick={handleOpenAddDialog} data-testid="button-add-insight" className="gap-2">
          <Plus className="w-4 h-4" />
          Add Insight
        </Button>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">Feature</TableHead>
              <TableHead className="min-w-[200px]">Context</TableHead>
              <TableHead className="min-w-[250px]">Customer Quote</TableHead>
              <TableHead className="min-w-[150px]">Company</TableHead>
              <TableHead className="min-w-[120px]">Category</TableHead>
              <TableHead className="min-w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedInsights.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {filteredInsights.length === 0 ? 'No insights found' : 'No insights on this page'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedInsights.map((insight) => (
                <TableRow key={insight.id} data-testid={`row-insight-${insight.id}`}>
                  <TableCell className="font-medium" data-testid={`text-feature-${insight.id}`}>
                    {insight.feature}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {insight.context}
                  </TableCell>
                  <TableCell>
                    <div className="border-l-2 border-chart-3 bg-chart-3/10 pl-3 py-2 italic text-sm">
                      "{insight.quote}"
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/companies/${insight.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}>
                      <Badge 
                        variant="secondary" 
                        className="font-normal cursor-pointer hover-elevate" 
                        data-testid={`badge-company-${insight.id}`}
                      >
                        {insight.company}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {insight.categoryId && insight.category !== 'NEW' ? (
                      <Link href={`/categories/${insight.categoryId}`}>
                        <Badge
                          variant="outline"
                          className="font-normal cursor-pointer hover-elevate"
                          data-testid={`badge-category-${insight.id}`}
                        >
                          {insight.category}
                        </Badge>
                      </Link>
                    ) : (
                      <Badge
                        variant={insight.category === 'NEW' ? 'default' : 'outline'}
                        className={insight.category === 'NEW' ? 'bg-chart-4 hover:bg-chart-4' : ''}
                        data-testid={`badge-category-${insight.id}`}
                      >
                        {insight.category}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleEdit(insight)}
                        data-testid={`button-edit-${insight.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(insight.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${insight.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {filteredInsights.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Showing {startIndex + 1}-{Math.min(endIndex, filteredInsights.length)} of {filteredInsights.length}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-[70px]" data-testid="select-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                data-testid="button-previous-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={!!editingInsight} onOpenChange={() => setEditingInsight(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Insight</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="feature">Feature</Label>
              <Input
                id="feature"
                value={editForm.feature}
                onChange={(e) => setEditForm({ ...editForm, feature: e.target.value })}
                data-testid="input-edit-feature"
              />
            </div>
            <div>
              <Label htmlFor="context">Context</Label>
              <Textarea
                id="context"
                value={editForm.context}
                onChange={(e) => setEditForm({ ...editForm, context: e.target.value })}
                data-testid="textarea-edit-context"
              />
            </div>
            <div>
              <Label htmlFor="quote">Quote</Label>
              <Textarea
                id="quote"
                value={editForm.quote}
                onChange={(e) => setEditForm({ ...editForm, quote: e.target.value })}
                data-testid="textarea-edit-quote"
              />
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Combobox
                options={[
                  { value: 'none', label: 'No category' },
                  ...categories.map(cat => ({ value: cat.id, label: cat.name }))
                ]}
                value={editForm.categoryId || 'none'}
                onValueChange={(value) => setEditForm({ ...editForm, categoryId: value === 'none' ? null : value })}
                placeholder="Select category"
                searchPlaceholder="Search categories..."
                emptyText="No category found."
                testId="select-edit-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingInsight(null)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={editMutation.isPending}
              data-testid="button-save-edit"
            >
              {editMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Product Insight</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="add-feature">Feature</Label>
              <Input
                id="add-feature"
                value={addForm.feature}
                onChange={(e) => setAddForm({ ...addForm, feature: e.target.value })}
                placeholder="E.g., Advanced Analytics Dashboard"
                data-testid="input-add-feature"
              />
            </div>
            <div>
              <Label htmlFor="add-context">Context</Label>
              <Textarea
                id="add-context"
                value={addForm.context}
                onChange={(e) => setAddForm({ ...addForm, context: e.target.value })}
                placeholder="Why this feature is valuable to the customer..."
                data-testid="textarea-add-context"
              />
            </div>
            <div>
              <Label htmlFor="add-quote">Quote</Label>
              <Textarea
                id="add-quote"
                value={addForm.quote}
                onChange={(e) => setAddForm({ ...addForm, quote: e.target.value })}
                placeholder="Customer's quote about this feature..."
                data-testid="textarea-add-quote"
              />
            </div>
            <div>
              <Label htmlFor="add-company">Company</Label>
              <Input
                id="add-company"
                value={addForm.company}
                onChange={(e) => setAddForm({ ...addForm, company: e.target.value })}
                placeholder="Company name"
                data-testid="input-add-company"
              />
            </div>
            <div>
              <Label htmlFor="add-category">Category</Label>
              <Combobox
                options={[
                  { value: 'none', label: 'No category' },
                  ...categories.map(cat => ({ value: cat.id, label: cat.name }))
                ]}
                value={addForm.categoryId || 'none'}
                onValueChange={(value) => setAddForm({ ...addForm, categoryId: value === 'none' ? null : value })}
                placeholder="Select category"
                searchPlaceholder="Search categories..."
                emptyText="No category found."
                testId="select-add-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAdd} 
              disabled={createMutation.isPending}
              data-testid="button-save-add"
            >
              {createMutation.isPending ? "Adding..." : "Add Insight"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
