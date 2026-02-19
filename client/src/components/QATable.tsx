import { useState, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { Search, Pencil, Trash2, Plus, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Star } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
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

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  asker: string;
  contactId?: string | null;
  contactName?: string | null;
  contactJobTitle?: string | null;
  company: string;
  companyId: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  isStarred?: string;
  product?: string;
  createdAt?: Date | string | null;
  transcriptDate?: Date | string | null;
}

export interface Category {
  id: string;
  name: string;
}

export interface Contact {
  id: string;
  name: string;
  jobTitle: string | null;
  companyId: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
}

const STORABLE_PRODUCTS = ["PitCrew", "AutoTrace", "WorkWatch", "ExpressLane", "Partnerships"] as const;

interface QATableProps {
  qaPairs: QAPair[];
  categories?: Category[];
  defaultCompany?: string;
  isAllActivity?: boolean;
}

export default function QATable({ qaPairs, categories = [], defaultCompany, isAllActivity = false }: QATableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [starredFilter, setStarredFilter] = useState('all');
  const [editingQA, setEditingQA] = useState<QAPair | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '', asker: '', company: '', categoryId: null as string | null, contactId: null as string | null, product: '' as string });
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ question: '', answer: '', asker: '', company: defaultCompany || '', categoryId: null as string | null, product: '' as string });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortColumn, setSortColumn] = useState<'category' | 'createdAt' | 'transcriptDate'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const { toast } = useToast();

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['/api/contacts/company', editingQA?.companyId],
    enabled: !!editingQA?.companyId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/qa-pairs/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/qa-pairs'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
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
    mutationFn: async ({ id, question, answer, asker, company, categoryId, contactId, product }: { id: string; question: string; answer: string; asker: string; company: string; categoryId: string | null; contactId?: string | null; product: string }) => {
      const payload: Record<string, string | null> = { question, answer, asker, company, contactId };
      if (isAllActivity && product) payload.product = product;
      const res = await apiRequest('PATCH', `/api/qa-pairs/${id}`, payload);
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
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
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

  const createMutation = useMutation({
    mutationFn: async ({ question, answer, asker, company, categoryId, product }: { question: string; answer: string; asker: string; company: string; categoryId: string | null; product: string }) => {
      const payload: Record<string, string | null> = { question, answer, asker, company, categoryId };
      if (isAllActivity && product) payload.product = product;
      const res = await apiRequest('POST', '/api/qa-pairs', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/qa-pairs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      setIsAddDialogOpen(false);
      setAddForm({ question: '', answer: '', asker: '', company: defaultCompany || '', categoryId: null, product: '' });
      toast({
        title: "Success",
        description: "Q&A pair added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add Q&A pair",
        variant: "destructive",
      });
    },
  });

  const toggleStarMutation = useMutation({
    mutationFn: async ({ id, isStarred }: { id: string; isStarred: string }) => {
      const res = await apiRequest('PATCH', `/api/qa-pairs/${id}/star`, { isStarred });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/qa-pairs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update star status",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (qa: QAPair) => {
    setEditingQA(qa);
    setEditForm({ 
      question: qa.question, 
      answer: qa.answer, 
      asker: qa.asker,
      company: qa.company,
      categoryId: qa.categoryId ?? null, 
      contactId: qa.contactId ?? null,
      product: qa.product || ''
    });
  };

  const handleSaveEdit = () => {
    if (editingQA) {
      const selectedContact = contacts.find(c => c.id === editForm.contactId);
      const asker = selectedContact ? selectedContact.name : (editingQA.asker || 'Unknown');
      editMutation.mutate({ 
        id: editingQA.id, 
        question: editForm.question,
        answer: editForm.answer,
        asker,
        company: editForm.company,
        categoryId: editForm.categoryId,
        contactId: editForm.contactId,
        product: editForm.product
      });
    }
  };

  const handleAdd = () => {
    if (!addForm.question || !addForm.answer || !addForm.asker || !addForm.company) {
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
    setAddForm({ question: '', answer: '', asker: '', company: defaultCompany || '', categoryId: null, product: '' });
    setIsAddDialogOpen(true);
  };

  const filteredQAPairs = qaPairs.filter(qa => {
    const matchesSearch = 
      qa.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.asker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.company.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || 
      (categoryFilter === 'NEW' && !qa.categoryId) ||
      qa.categoryId === categoryFilter;
    
    const matchesStarred = starredFilter === 'all' || 
      (starredFilter === 'starred' && qa.isStarred === 'true') ||
      (starredFilter === 'unstarred' && qa.isStarred !== 'true');
    
    return matchesSearch && matchesCategory && matchesStarred;
  });

  const handleSort = (column: 'category' | 'createdAt' | 'transcriptDate') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedQAPairs = [...filteredQAPairs].sort((a, b) => {
    let comparison = 0;
    
    if (sortColumn === 'category') {
      const aVal = (a.categoryName || '').toLowerCase();
      const bVal = (b.categoryName || '').toLowerCase();
      comparison = aVal.localeCompare(bVal);
    } else if (sortColumn === 'createdAt') {
      const aTime = a.createdAt ? (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : a.createdAt.getTime()) : 0;
      const bTime = b.createdAt ? (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : b.createdAt.getTime()) : 0;
      comparison = aTime - bTime;
    } else if (sortColumn === 'transcriptDate') {
      const aTime = a.transcriptDate ? (typeof a.transcriptDate === 'string' ? new Date(a.transcriptDate).getTime() : a.transcriptDate.getTime()) : 0;
      const bTime = b.transcriptDate ? (typeof b.transcriptDate === 'string' ? new Date(b.transcriptDate).getTime() : b.transcriptDate.getTime()) : 0;
      comparison = aTime - bTime;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const totalPages = Math.max(1, Math.ceil(sortedQAPairs.length / pageSize));
  
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedQAPairs = sortedQAPairs.slice(startIndex, endIndex);

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

  const handleStarredFilterChange = (value: string) => {
    setStarredFilter(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap items-center justify-between">
        <div className="flex gap-4 flex-wrap flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search questions or answers..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              data-testid="input-search-qa"
            />
          </div>
          <Select value={starredFilter} onValueChange={handleStarredFilterChange}>
            <SelectTrigger className="w-[140px]" data-testid="select-starred-filter-qa">
              <SelectValue placeholder="All Q&As" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Q&As</SelectItem>
              <SelectItem value="starred">Starred</SelectItem>
              <SelectItem value="unstarred">Unstarred</SelectItem>
            </SelectContent>
          </Select>
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
            testId="select-category-filter-qa"
          />
        </div>
        <Button onClick={handleOpenAddDialog} data-testid="button-add-qa" className="gap-2">
          <Plus className="w-4 h-4" />
          Add Q&A Pair
        </Button>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead className="min-w-[250px]">Question</TableHead>
              <TableHead className="min-w-[250px]">Answer</TableHead>
              <TableHead className="min-w-[150px]">Asked By</TableHead>
              <TableHead className="min-w-[150px]">Company</TableHead>
              {isAllActivity && (
                <TableHead className="min-w-[120px]">Product</TableHead>
              )}
              <TableHead className="min-w-[120px]">
                <button 
                  onClick={() => handleSort('category')} 
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  data-testid="button-sort-category-qa"
                >
                  Category
                  {sortColumn === 'category' ? (
                    sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-50" />
                  )}
                </button>
              </TableHead>
              <TableHead className="min-w-[150px]">
                <button 
                  onClick={() => handleSort('transcriptDate')} 
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  data-testid="button-sort-transcript-date-qa"
                >
                  Transcript Date
                  {sortColumn === 'transcriptDate' ? (
                    sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-50" />
                  )}
                </button>
              </TableHead>
              <TableHead className="min-w-[150px]">
                <button 
                  onClick={() => handleSort('createdAt')} 
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  data-testid="button-sort-created-qa"
                >
                  Created On
                  {sortColumn === 'createdAt' ? (
                    sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-50" />
                  )}
                </button>
              </TableHead>
              <TableHead className="min-w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedQAPairs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAllActivity ? 10 : 9} className="text-center py-8 text-muted-foreground">
                  {filteredQAPairs.length === 0 ? 'No Q&A pairs found' : 'No Q&A pairs on this page'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedQAPairs.map((qa) => (
                <TableRow key={qa.id} data-testid={`row-qa-${qa.id}`}>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleStarMutation.mutate({ 
                        id: qa.id, 
                        isStarred: qa.isStarred === 'true' ? 'false' : 'true' 
                      })}
                      disabled={toggleStarMutation.isPending}
                      data-testid={`button-star-${qa.id}`}
                      className={qa.isStarred === 'true' ? 'text-yellow-500' : ''}
                    >
                      <Star className={`w-4 h-4 ${qa.isStarred === 'true' ? 'fill-current' : ''}`} />
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium" data-testid={`text-question-${qa.id}`}>
                    {qa.question}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {qa.answer}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="secondary" className="font-normal w-fit" data-testid={`badge-asker-${qa.id}`}>
                        {qa.contactName || qa.asker}
                      </Badge>
                      {qa.contactJobTitle && (
                        <span className="text-xs text-muted-foreground" data-testid={`text-job-title-${qa.id}`}>
                          {qa.contactJobTitle}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/companies/${qa.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}>
                      <Badge 
                        variant="outline" 
                        className="font-normal cursor-pointer hover-elevate" 
                        data-testid={`badge-company-${qa.id}`}
                      >
                        {qa.company}
                      </Badge>
                    </Link>
                  </TableCell>
                  {isAllActivity && (
                    <TableCell data-testid={`text-product-${qa.id}`}>
                      <Badge variant="outline" className="font-normal">
                        {qa.product || 'Unknown'}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell>
                    {qa.categoryId && qa.categoryName ? (
                      <Link href={`/categories/${qa.categoryId}`}>
                        <Badge
                          variant="outline"
                          className="font-normal cursor-pointer hover-elevate"
                          data-testid={`badge-category-${qa.id}`}
                        >
                          {qa.categoryName}
                        </Badge>
                      </Link>
                    ) : (
                      <Badge
                        variant="default"
                        className="bg-chart-4 hover:bg-chart-4"
                        data-testid={`badge-category-${qa.id}`}
                      >
                        NEW
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground" data-testid={`text-transcript-date-${qa.id}`}>
                    {qa.transcriptDate ? (() => {
                      const dateStr = typeof qa.transcriptDate === 'string' ? qa.transcriptDate : qa.transcriptDate.toISOString();
                      const datePart = dateStr.split('T')[0];
                      return new Date(datePart + 'T12:00:00').toLocaleDateString();
                    })() : '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground" data-testid={`text-created-${qa.id}`}>
                    {qa.createdAt ? new Date(qa.createdAt).toLocaleString() : '-'}
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

      {filteredQAPairs.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Showing {startIndex + 1}-{Math.min(endIndex, filteredQAPairs.length)} of {filteredQAPairs.length}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-[70px]" data-testid="select-page-size-qa">
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
                data-testid="button-previous-page-qa"
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
                data-testid="button-next-page-qa"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

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
              <Label htmlFor="contact">Asked By</Label>
              <Combobox
                options={[
                  { value: 'none', label: 'No contact' },
                  ...contacts.map(contact => ({ 
                    value: contact.id, 
                    label: contact.jobTitle ? `${contact.name} (${contact.jobTitle})` : contact.name 
                  }))
                ]}
                value={editForm.contactId ?? 'none'}
                onValueChange={(value) => setEditForm({ ...editForm, contactId: value === 'none' ? null : value })}
                placeholder="Select contact"
                searchPlaceholder="Search contacts..."
                emptyText="No contact found."
                testId="select-edit-contact-qa"
              />
            </div>
            <div>
              <Label htmlFor="edit-company-qa">Company</Label>
              <Combobox
                options={companies.map(comp => ({ value: comp.name, label: comp.name }))}
                value={editForm.company}
                onValueChange={(value) => setEditForm({ ...editForm, company: value })}
                placeholder="Select company"
                searchPlaceholder="Search companies..."
                emptyText="No company found."
                testId="select-edit-company-qa"
              />
            </div>
            {isAllActivity && (
              <div>
                <Label htmlFor="edit-product-qa">Product</Label>
                <Select
                  value={editForm.product}
                  onValueChange={(value) => setEditForm({ ...editForm, product: value })}
                >
                  <SelectTrigger data-testid="select-edit-product-qa">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {STORABLE_PRODUCTS.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
                testId="select-edit-category-qa"
              />
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

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Q&A Pair</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="add-question">Question</Label>
              <Textarea
                id="add-question"
                value={addForm.question}
                onChange={(e) => setAddForm({ ...addForm, question: e.target.value })}
                placeholder="What was the question asked?"
                data-testid="textarea-add-question"
              />
            </div>
            <div>
              <Label htmlFor="add-answer">Answer</Label>
              <Textarea
                id="add-answer"
                value={addForm.answer}
                onChange={(e) => setAddForm({ ...addForm, answer: e.target.value })}
                placeholder="What was the answer provided?"
                data-testid="textarea-add-answer"
              />
            </div>
            <div>
              <Label htmlFor="add-asker">Asked By</Label>
              <Input
                id="add-asker"
                value={addForm.asker}
                onChange={(e) => setAddForm({ ...addForm, asker: e.target.value })}
                placeholder="Person who asked the question"
                data-testid="input-add-asker"
              />
            </div>
            <div>
              <Label htmlFor="add-company-qa">Company</Label>
              <Combobox
                options={companies.map(comp => ({ value: comp.name, label: comp.name }))}
                value={addForm.company}
                onValueChange={(value) => setAddForm({ ...addForm, company: value })}
                placeholder="Select company"
                searchPlaceholder="Search companies..."
                emptyText="No company found."
                testId="select-add-company-qa"
              />
            </div>
            {isAllActivity && (
              <div>
                <Label htmlFor="add-product-qa">Product</Label>
                <Select
                  value={addForm.product}
                  onValueChange={(value) => setAddForm({ ...addForm, product: value })}
                >
                  <SelectTrigger data-testid="select-add-product-qa">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {STORABLE_PRODUCTS.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
                testId="select-add-category-qa"
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
              {createMutation.isPending ? "Adding..." : "Add Q&A Pair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
