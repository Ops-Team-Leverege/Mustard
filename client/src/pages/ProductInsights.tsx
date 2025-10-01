import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ProductInsights() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isAddingInsight, setIsAddingInsight] = useState(false);
  const [newInsightForm, setNewInsightForm] = useState({
    feature: '',
    context: '',
    quote: '',
    company: '',
    categoryId: null as string | null,
  });

  const { data: insights = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/insights'],
  });

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['/api/categories'],
  });

  const addInsightMutation = useMutation({
    mutationFn: async (data: { feature: string; context: string; quote: string; company: string; categoryId: string | null }) => {
      const res = await apiRequest('POST', '/api/insights', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setIsAddingInsight(false);
      setNewInsightForm({ feature: '', context: '', quote: '', company: '', categoryId: null });
      toast({
        title: "Success",
        description: "Product insight added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add product insight",
        variant: "destructive",
      });
    },
  });

  const handleAddInsight = () => {
    if (!newInsightForm.feature || !newInsightForm.context || !newInsightForm.quote || !newInsightForm.company) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    addInsightMutation.mutate(newInsightForm);
  };

  // Transform data to match component interface
  const tableInsights = (insights as any[]).map((insight: any) => ({
    id: insight.id,
    feature: insight.feature,
    context: insight.context,
    quote: insight.quote,
    company: insight.company,
    category: insight.categoryName || 'NEW',
    categoryId: insight.categoryId || null,
  }));

  // Pass full category objects with id and name
  const categoryObjects = (categories as any[]).map((cat: any) => ({
    id: cat.id,
    name: cat.name,
  }));

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Product Insights & Feature Demand</h1>
          <p className="text-muted-foreground mt-1">
            Feature requests and context from BD calls
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsAddingInsight(true)} data-testid="button-add-insight">
            <Plus className="w-4 h-4 mr-2" />
            Add Insight
          </Button>
          <Button onClick={() => setLocation('/')} data-testid="button-add-transcript">
            <Plus className="w-4 h-4 mr-2" />
            Add Transcript
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading insights...</div>
      ) : (
        <ProductInsightsTable insights={tableInsights} categories={categoryObjects} />
      )}

      <Dialog open={isAddingInsight} onOpenChange={setIsAddingInsight}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Product Insight</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="feature">Feature *</Label>
              <Input
                id="feature"
                value={newInsightForm.feature}
                onChange={(e) => setNewInsightForm({ ...newInsightForm, feature: e.target.value })}
                placeholder="e.g., Real-time Analytics"
                data-testid="input-add-feature"
              />
            </div>
            <div>
              <Label htmlFor="context">Context *</Label>
              <Textarea
                id="context"
                value={newInsightForm.context}
                onChange={(e) => setNewInsightForm({ ...newInsightForm, context: e.target.value })}
                placeholder="Why this feature is valuable to the customer"
                data-testid="textarea-add-context"
              />
            </div>
            <div>
              <Label htmlFor="quote">Customer Quote *</Label>
              <Textarea
                id="quote"
                value={newInsightForm.quote}
                onChange={(e) => setNewInsightForm({ ...newInsightForm, quote: e.target.value })}
                placeholder="What the customer said about this feature"
                data-testid="textarea-add-quote"
              />
            </div>
            <div>
              <Label htmlFor="company">Company *</Label>
              <Input
                id="company"
                value={newInsightForm.company}
                onChange={(e) => setNewInsightForm({ ...newInsightForm, company: e.target.value })}
                placeholder="Company name"
                data-testid="input-add-company"
              />
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select 
                value={newInsightForm.categoryId || 'none'} 
                onValueChange={(value) => setNewInsightForm({ ...newInsightForm, categoryId: value === 'none' ? null : value })}
              >
                <SelectTrigger id="category" data-testid="select-add-category">
                  <SelectValue placeholder="Select category (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categoryObjects.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingInsight(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddInsight} 
              disabled={addInsightMutation.isPending}
              data-testid="button-save-add-insight"
            >
              {addInsightMutation.isPending ? "Adding..." : "Add Insight"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
