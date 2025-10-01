import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Pencil, Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  asker: string;
  company: string;
  categoryId?: string | null;
  categoryName?: string | null;
}

export interface Category {
  id: string;
  name: string;
}

interface QATableProps {
  qaPairs: QAPair[];
  categories?: Category[];
}

export default function QATable({ qaPairs, categories = [] }: QATableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingQA, setEditingQA] = useState<QAPair | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '', asker: '', categoryId: null as string | null });
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/qa-pairs/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/qa-pairs'] });
      toast({
        title: "Success",
        description: "Q&A pair deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete Q&A pair",
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, question, answer, asker, categoryId }: { id: string; question: string; answer: string; asker: string; categoryId: string | null }) => {
      // Update the Q&A pair
      const res = await apiRequest('PATCH', `/api/qa-pairs/${id}`, { question, answer, asker });
      if (!res.ok) {
        throw new Error('Failed to update Q&A pair');
      }
      
      // Update category separately
      const catRes = await apiRequest('PATCH', `/api/qa-pairs/${id}/category`, { categoryId });
      if (!catRes.ok) {
        throw new Error('Failed to update category');
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/qa-pairs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setEditingQA(null);
      toast({
        title: "Success",
        description: "Q&A pair updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update Q&A pair",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (qa: QAPair) => {
    setEditingQA(qa);
    setEditForm({ question: qa.question, answer: qa.answer, asker: qa.asker, categoryId: qa.categoryId || null });
  };

  const handleSaveEdit = () => {
    if (editingQA) {
      editMutation.mutate({ id: editingQA.id, ...editForm });
    }
  };

  const filteredQAPairs = qaPairs.filter(qa => {
    return (
      qa.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.asker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.company.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search questions or answers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search-qa"
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Question</TableHead>
              <TableHead>Answer</TableHead>
              <TableHead className="w-[150px]">Asked By</TableHead>
              <TableHead className="w-[150px]">Company</TableHead>
              <TableHead className="w-[120px]">Category</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredQAPairs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No Q&A pairs found
                </TableCell>
              </TableRow>
            ) : (
              filteredQAPairs.map((qa) => (
                <TableRow key={qa.id} data-testid={`row-qa-${qa.id}`}>
                  <TableCell className="font-medium" data-testid={`text-question-${qa.id}`}>
                    {qa.question}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {qa.answer}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal" data-testid={`badge-asker-${qa.id}`}>
                      {qa.asker}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal" data-testid={`badge-company-${qa.id}`}>
                      {qa.company}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={!qa.categoryName ? 'default' : 'outline'}
                      className={!qa.categoryName ? 'bg-chart-4 hover:bg-chart-4' : ''}
                      data-testid={`badge-category-${qa.id}`}
                    >
                      {qa.categoryName || 'NEW'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleEdit(qa)}
                        data-testid={`button-edit-${qa.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(qa.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${qa.id}`}
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

      <Dialog open={!!editingQA} onOpenChange={() => setEditingQA(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Q&A Pair</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="question">Question</Label>
              <Textarea
                id="question"
                value={editForm.question}
                onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
                data-testid="textarea-edit-question"
              />
            </div>
            <div>
              <Label htmlFor="answer">Answer</Label>
              <Textarea
                id="answer"
                value={editForm.answer}
                onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
                data-testid="textarea-edit-answer"
              />
            </div>
            <div>
              <Label htmlFor="asker">Asked By</Label>
              <Input
                id="asker"
                value={editForm.asker}
                onChange={(e) => setEditForm({ ...editForm, asker: e.target.value })}
                data-testid="input-edit-asker"
              />
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select 
                value={editForm.categoryId || 'none'} 
                onValueChange={(value) => setEditForm({ ...editForm, categoryId: value === 'none' ? null : value })}
              >
                <SelectTrigger id="category" data-testid="select-edit-category-qa">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingQA(null)}>
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
