import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Pencil, Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ProductInsight {
  id: string;
  feature: string;
  context: string;
  quote: string;
  company: string;
  category: string;
}

interface ProductInsightsTableProps {
  insights: ProductInsight[];
  categories?: string[];
}

export default function ProductInsightsTable({ insights, categories = [] }: ProductInsightsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingInsight, setEditingInsight] = useState<ProductInsight | null>(null);
  const [editForm, setEditForm] = useState({ feature: '', context: '', quote: '' });
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/insights/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
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
    mutationFn: async ({ id, feature, context, quote }: { id: string; feature: string; context: string; quote: string }) => {
      const res = await apiRequest('PATCH', `/api/insights/${id}`, { feature, context, quote });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
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

  const handleEdit = (insight: ProductInsight) => {
    setEditingInsight(insight);
    setEditForm({ feature: insight.feature, context: insight.context, quote: insight.quote });
  };

  const handleSaveEdit = () => {
    if (editingInsight) {
      editMutation.mutate({ id: editingInsight.id, ...editForm });
    }
  };

  const filteredInsights = insights.filter(insight => {
    const matchesSearch = 
      insight.feature.toLowerCase().includes(searchQuery.toLowerCase()) ||
      insight.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      insight.context.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || insight.category === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search features or companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-insights"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
            <SelectItem value="NEW">NEW</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Feature</TableHead>
              <TableHead className="w-[200px]">Context</TableHead>
              <TableHead>Customer Quote</TableHead>
              <TableHead className="w-[150px]">Company</TableHead>
              <TableHead className="w-[120px]">Category</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInsights.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No insights found
                </TableCell>
              </TableRow>
            ) : (
              filteredInsights.map((insight) => (
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
                    <Badge variant="secondary" className="font-normal" data-testid={`badge-company-${insight.id}`}>
                      {insight.company}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={insight.category === 'NEW' ? 'default' : 'outline'}
                      className={insight.category === 'NEW' ? 'bg-chart-4 hover:bg-chart-4' : ''}
                      data-testid={`badge-category-${insight.id}`}
                    >
                      {insight.category}
                    </Badge>
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
    </div>
  );
}
