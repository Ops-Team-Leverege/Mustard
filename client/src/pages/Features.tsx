import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertFeatureSchema, type InsertFeature } from "@shared/schema";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type Feature = {
  id: string;
  name: string;
  description: string | null;
  value: string | null;
  videoLink: string | null;
  helpGuideLink: string | null;
  categoryId: string | null;
  categoryName: string | null;
  releaseDate: Date | null;
  createdAt: Date;
};

type Category = {
  id: string;
  name: string;
};

export default function Features() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const addForm = useForm<InsertFeature>({
    resolver: zodResolver(insertFeatureSchema),
    defaultValues: {
      name: "",
      description: null,
      value: null,
      videoLink: null,
      helpGuideLink: null,
      categoryId: null,
      releaseDate: null,
    },
  });

  const editForm = useForm<InsertFeature>({
    resolver: zodResolver(insertFeatureSchema),
    defaultValues: {
      name: "",
      description: null,
      value: null,
      videoLink: null,
      helpGuideLink: null,
      categoryId: null,
      releaseDate: null,
    },
  });

  const { data: features = [], isLoading } = useQuery<Feature[]>({
    queryKey: ['/api/features'],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const addMutation = useMutation({
    mutationFn: async (data: InsertFeature) => {
      const payload = {
        ...data,
        releaseDate: data.releaseDate ? data.releaseDate.toISOString() : null,
      };
      const res = await apiRequest('POST', '/api/features', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/features'] });
      toast({
        title: "Feature Added",
        description: "The feature has been created successfully.",
      });
      setIsAddDialogOpen(false);
      addForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Feature",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async (data: { id: string } & InsertFeature) => {
      const { id, ...updateData } = data;
      const payload = {
        ...updateData,
        releaseDate: updateData.releaseDate ? updateData.releaseDate.toISOString() : null,
      };
      const res = await apiRequest('PATCH', `/api/features/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/features'] });
      toast({
        title: "Feature Updated",
        description: "The feature has been updated successfully.",
      });
      setIsEditDialogOpen(false);
      setSelectedFeature(null);
      editForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Feature",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/features/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/features'] });
      toast({
        title: "Feature Deleted",
        description: "The feature has been deleted successfully.",
      });
      setIsDeleteDialogOpen(false);
      setSelectedFeature(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Feature",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAdd = () => {
    addForm.reset({
      name: "",
      description: null,
      value: null,
      videoLink: null,
      helpGuideLink: null,
      categoryId: null,
      releaseDate: null,
    });
    setIsAddDialogOpen(true);
  };

  const handleEdit = (feature: Feature) => {
    setSelectedFeature(feature);
    const releaseDateValue = feature.releaseDate ? new Date(feature.releaseDate) : null;
    editForm.reset({
      name: feature.name,
      description: feature.description,
      value: feature.value,
      videoLink: feature.videoLink,
      helpGuideLink: feature.helpGuideLink,
      categoryId: feature.categoryId,
      releaseDate: releaseDateValue,
    });
    setIsEditDialogOpen(true);
  };

  const handleDelete = (feature: Feature) => {
    setSelectedFeature(feature);
    setIsDeleteDialogOpen(true);
  };

  const onAddSubmit = (data: InsertFeature) => {
    addMutation.mutate(data);
  };

  const onEditSubmit = (data: InsertFeature) => {
    if (selectedFeature) {
      editMutation.mutate({ id: selectedFeature.id, ...data });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedFeature) {
      deleteMutation.mutate(selectedFeature.id);
    }
  };

  // Filter features based on search and category
  const filteredFeatures = features.filter((feature) => {
    const matchesSearch = searchQuery === "" || 
      feature.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (feature.description && feature.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (feature.value && feature.value.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCategory = categoryFilter === "all" || 
      (categoryFilter === "none" && !feature.categoryId) ||
      feature.categoryId === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  // Filter features released in the last 2 weeks
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  
  const recentlyReleasedFeatures = features.filter((feature) => {
    if (!feature.releaseDate) return false;
    const releaseDate = new Date(feature.releaseDate);
    return releaseDate >= twoWeeksAgo && releaseDate <= new Date();
  }).sort((a, b) => {
    const dateA = new Date(a.releaseDate!);
    const dateB = new Date(b.releaseDate!);
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Existing Features</h1>
          <p className="text-muted-foreground mt-1">
            Manage existing product features with demos and guides
          </p>
        </div>
        <Button onClick={handleAdd} data-testid="button-add-feature">
          <Plus className="w-4 h-4 mr-2" />
          Add Feature
        </Button>
      </div>

      {/* Recently Released Card */}
      {!isLoading && recentlyReleasedFeatures.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Recently Released</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentlyReleasedFeatures.map((feature) => (
                <Link key={feature.id} href={`/features/${feature.id}`}>
                  <div 
                    className="flex items-center justify-between p-3 rounded-md hover-elevate cursor-pointer border" 
                    data-testid={`recent-feature-${feature.id}`}
                  >
                    <div className="flex-1">
                      <h4 className="font-medium text-sm" data-testid={`text-feature-name-${feature.id}`}>
                        {feature.name}
                      </h4>
                      {feature.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                          {feature.description}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground ml-4">
                      {new Date(feature.releaseDate!).toLocaleDateString()}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search and Filter */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            type="text"
            placeholder="Search by name, description, or value..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-features"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-64" data-testid="select-category-filter">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="none">No Category</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading features...</div>
      ) : features.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No features yet. Click "Add Feature" to create one.
        </div>
      ) : filteredFeatures.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No features match your search or filter criteria.
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Video Demo</TableHead>
                <TableHead>Help Guide</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFeatures.map((feature) => (
                <TableRow key={feature.id} data-testid={`row-feature-${feature.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/features/${feature.id}`}>
                      <button className="text-primary hover:underline text-left" data-testid={`link-feature-${feature.id}`}>
                        {feature.name}
                      </button>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <div className="whitespace-pre-wrap line-clamp-3">{feature.description || "—"}</div>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <div className="whitespace-pre-wrap line-clamp-3">{feature.value || "—"}</div>
                  </TableCell>
                  <TableCell>
                    {feature.categoryName ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground">
                        {feature.categoryName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {feature.videoLink ? (
                      <a
                        href={feature.videoLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-primary hover:underline"
                        data-testid={`link-video-${feature.id}`}
                      >
                        View <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {feature.helpGuideLink ? (
                      <a
                        href={feature.helpGuideLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-primary hover:underline"
                        data-testid={`link-guide-${feature.id}`}
                      >
                        View <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(feature)}
                        data-testid={`button-edit-${feature.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(feature)}
                        data-testid={`button-delete-${feature.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Feature Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent data-testid="dialog-add-feature">
          <DialogHeader>
            <DialogTitle>Add New Feature</DialogTitle>
            <DialogDescription>
              Add details about an existing product feature.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4 py-4">
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Feature name" 
                        {...field} 
                        data-testid="input-feature-name"
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
                        placeholder="Brief description (supports bullet points and multiple lines)"
                        rows={4}
                        {...field}
                        value={field.value || ""}
                        data-testid="input-feature-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Value (Why This Feature Matters)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Explain why this feature matters and the value it provides"
                        rows={3}
                        {...field}
                        value={field.value || ""}
                        data-testid="input-feature-value"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="videoLink"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Video Link (Demo)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://..."
                        {...field}
                        value={field.value || ""}
                        data-testid="input-feature-videolink"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="helpGuideLink"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Help Guide Link</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://..."
                        {...field}
                        value={field.value || ""}
                        data-testid="input-feature-helpguidelink"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-feature-category">
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="releaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Release Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value ? new Date(field.value).toISOString().split('T')[0] : ""}
                        onChange={(e) => {
                          const value = e.target.value.trim();
                          field.onChange(value ? new Date(value) : null);
                        }}
                        data-testid="input-feature-releasedate"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsAddDialogOpen(false)} 
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={addMutation.isPending} 
                  data-testid="button-submit-add"
                >
                  {addMutation.isPending ? "Adding..." : "Add Feature"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Feature Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent data-testid="dialog-edit-feature">
          <DialogHeader>
            <DialogTitle>Edit Feature</DialogTitle>
            <DialogDescription>
              Update feature details.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 py-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Feature name" 
                        {...field} 
                        data-testid="input-edit-name"
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
                        placeholder="Brief description (supports bullet points and multiple lines)"
                        rows={4}
                        {...field}
                        value={field.value || ""}
                        data-testid="input-edit-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Value (Why This Feature Matters)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Explain why this feature matters and the value it provides"
                        rows={3}
                        {...field}
                        value={field.value || ""}
                        data-testid="input-edit-value"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="videoLink"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Video Link (Demo)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://..."
                        {...field}
                        value={field.value || ""}
                        data-testid="input-edit-videolink"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="helpGuideLink"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Help Guide Link</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://..."
                        {...field}
                        value={field.value || ""}
                        data-testid="input-edit-helpguidelink"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-category">
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="releaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Release Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value ? new Date(field.value).toISOString().split('T')[0] : ""}
                        onChange={(e) => {
                          const value = e.target.value.trim();
                          field.onChange(value ? new Date(value) : null);
                        }}
                        data-testid="input-edit-releasedate"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsEditDialogOpen(false)} 
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={editMutation.isPending} 
                  data-testid="button-submit-edit"
                >
                  {editMutation.isPending ? "Updating..." : "Update Feature"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-feature">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feature</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedFeature?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
