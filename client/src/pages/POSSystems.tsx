import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPOSSystemSchema, type InsertPOSSystem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, ExternalLink, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

type POSSystem = {
  id: string;
  name: string;
  websiteLink: string | null;
  description: string | null;
  createdAt: Date;
  companies: Company[];
};

type Company = {
  id: string;
  name: string;
};

export default function POSSystems() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedSystem, setSelectedSystem] = useState<POSSystem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);

  const addForm = useForm<InsertPOSSystem>({
    resolver: zodResolver(insertPOSSystemSchema),
    defaultValues: {
      name: "",
      websiteLink: null,
      description: null,
      companyIds: [],
    },
  });

  const editForm = useForm<InsertPOSSystem>({
    resolver: zodResolver(insertPOSSystemSchema),
    defaultValues: {
      name: "",
      websiteLink: null,
      description: null,
      companyIds: [],
    },
  });

  const { data: posSystems = [], isLoading } = useQuery<POSSystem[]>({
    queryKey: ['/api/pos-systems'],
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const addMutation = useMutation({
    mutationFn: async (data: InsertPOSSystem) => {
      const res = await apiRequest('POST', '/api/pos-systems', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pos-systems'] });
      toast({
        title: "POS System Added",
        description: "The POS system has been created successfully.",
      });
      setIsAddDialogOpen(false);
      setSelectedCompanies([]);
      addForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add POS System",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async (data: { id: string } & InsertPOSSystem) => {
      const { id, ...updateData } = data;
      const res = await apiRequest('PATCH', `/api/pos-systems/${id}`, updateData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pos-systems'] });
      toast({
        title: "POS System Updated",
        description: "The POS system has been updated successfully.",
      });
      setIsEditDialogOpen(false);
      setSelectedSystem(null);
      setSelectedCompanies([]);
      editForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update POS System",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/pos-systems/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pos-systems'] });
      toast({
        title: "POS System Deleted",
        description: "The POS system has been deleted successfully.",
      });
      setIsDeleteDialogOpen(false);
      setSelectedSystem(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete POS System",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddSubmit = (data: InsertPOSSystem) => {
    addMutation.mutate({
      ...data,
      companyIds: selectedCompanies,
    });
  };

  const handleEditSubmit = (data: InsertPOSSystem) => {
    if (!selectedSystem) return;
    editMutation.mutate({
      id: selectedSystem.id,
      ...data,
      companyIds: selectedCompanies,
    });
  };

  const openEditDialog = (system: POSSystem) => {
    setSelectedSystem(system);
    setSelectedCompanies(system.companies.map(c => c.id));
    editForm.reset({
      name: system.name,
      websiteLink: system.websiteLink,
      description: system.description,
      companyIds: system.companies.map(c => c.id),
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (system: POSSystem) => {
    setSelectedSystem(system);
    setIsDeleteDialogOpen(true);
  };

  const filteredSystems = posSystems.filter((system) =>
    system.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleCompany = (companyId: string) => {
    setSelectedCompanies(prev =>
      prev.includes(companyId)
        ? prev.filter(id => id !== companyId)
        : [...prev, companyId]
    );
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-2xl">Point of Sales Systems</CardTitle>
            <Button
              onClick={() => {
                setSelectedCompanies([]);
                addForm.reset();
                setIsAddDialogOpen(true);
              }}
              data-testid="button-add-pos-system"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add POS System
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search POS systems..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
                data-testid="input-search-pos-systems"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Companies</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSystems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No POS systems found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSystems.map((system) => (
                    <TableRow key={system.id} data-testid={`row-pos-system-${system.id}`}>
                      <TableCell className="font-medium">{system.name}</TableCell>
                      <TableCell>
                        {system.websiteLink ? (
                          <a
                            href={system.websiteLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                            data-testid={`link-website-${system.id}`}
                          >
                            Visit <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {system.description || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {system.companies.length > 0 ? (
                            system.companies.map((company) => (
                              <Badge key={company.id} variant="secondary" data-testid={`badge-company-${company.id}`}>
                                {company.name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(system)}
                            data-testid={`button-edit-${system.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(system)}
                            data-testid={`button-delete-${system.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add POS System</DialogTitle>
            <DialogDescription>
              Create a new point of sales system and associate it with companies.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(handleAddSubmit)} className="space-y-4">
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Square, Toast, Clover" data-testid="input-add-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={addForm.control}
                name="websiteLink"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website Link</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="https://example.com"
                        data-testid="input-add-website"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={addForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value || ""}
                        placeholder="Brief description of the POS system..."
                        rows={3}
                        data-testid="input-add-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>Companies</FormLabel>
                <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                  {companies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No companies available</p>
                  ) : (
                    companies.map((company) => (
                      <div key={company.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`add-company-${company.id}`}
                          checked={selectedCompanies.includes(company.id)}
                          onCheckedChange={() => toggleCompany(company.id)}
                          data-testid={`checkbox-add-company-${company.id}`}
                        />
                        <label
                          htmlFor={`add-company-${company.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {company.name}
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddDialogOpen(false);
                    setSelectedCompanies([]);
                    addForm.reset();
                  }}
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={addMutation.isPending} data-testid="button-submit-add">
                  {addMutation.isPending ? "Adding..." : "Add POS System"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit POS System</DialogTitle>
            <DialogDescription>
              Update the POS system details and company associations.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Square, Toast, Clover" data-testid="input-edit-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="websiteLink"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website Link</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="https://example.com"
                        data-testid="input-edit-website"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value || ""}
                        placeholder="Brief description of the POS system..."
                        rows={3}
                        data-testid="input-edit-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>Companies</FormLabel>
                <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                  {companies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No companies available</p>
                  ) : (
                    companies.map((company) => (
                      <div key={company.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-company-${company.id}`}
                          checked={selectedCompanies.includes(company.id)}
                          onCheckedChange={() => toggleCompany(company.id)}
                          data-testid={`checkbox-edit-company-${company.id}`}
                        />
                        <label
                          htmlFor={`edit-company-${company.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {company.name}
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditDialogOpen(false);
                    setSelectedSystem(null);
                    setSelectedCompanies([]);
                    editForm.reset();
                  }}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={editMutation.isPending} data-testid="button-submit-edit">
                  {editMutation.isPending ? "Updating..." : "Update POS System"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the POS system "{selectedSystem?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedSystem && deleteMutation.mutate(selectedSystem.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
