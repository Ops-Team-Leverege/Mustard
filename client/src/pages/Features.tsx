import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";

type Feature = {
  id: string;
  name: string;
  description: string | null;
  videoLink: string | null;
  helpGuideLink: string | null;
  categoryId: string | null;
  categoryName: string | null;
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
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    videoLink: "",
    helpGuideLink: "",
    categoryId: "",
  });

  const { data: features = [], isLoading } = useQuery<Feature[]>({
    queryKey: ['/api/features'],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest('POST', '/api/features', {
        name: data.name,
        description: data.description || null,
        videoLink: data.videoLink || null,
        helpGuideLink: data.helpGuideLink || null,
        categoryId: data.categoryId || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/features'] });
      toast({
        title: "Feature Added",
        description: "The feature has been created successfully.",
      });
      setIsAddDialogOpen(false);
      resetForm();
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
    mutationFn: async (data: { id: string } & typeof formData) => {
      const res = await apiRequest('PATCH', `/api/features/${data.id}`, {
        name: data.name,
        description: data.description || null,
        videoLink: data.videoLink || null,
        helpGuideLink: data.helpGuideLink || null,
        categoryId: data.categoryId || null,
      });
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
      resetForm();
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

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      videoLink: "",
      helpGuideLink: "",
      categoryId: "",
    });
  };

  const handleAdd = () => {
    resetForm();
    setIsAddDialogOpen(true);
  };

  const handleEdit = (feature: Feature) => {
    setSelectedFeature(feature);
    setFormData({
      name: feature.name,
      description: feature.description || "",
      videoLink: feature.videoLink || "",
      helpGuideLink: feature.helpGuideLink || "",
      categoryId: feature.categoryId || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleDelete = (feature: Feature) => {
    setSelectedFeature(feature);
    setIsDeleteDialogOpen(true);
  };

  const handleSubmitAdd = () => {
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Feature name is required.",
        variant: "destructive",
      });
      return;
    }
    addMutation.mutate(formData);
  };

  const handleSubmitEdit = () => {
    if (!formData.name.trim() || !selectedFeature) {
      toast({
        title: "Validation Error",
        description: "Feature name is required.",
        variant: "destructive",
      });
      return;
    }
    editMutation.mutate({ id: selectedFeature.id, ...formData });
  };

  const handleConfirmDelete = () => {
    if (selectedFeature) {
      deleteMutation.mutate(selectedFeature.id);
    }
  };

  return (
    <div className="container mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Features</h1>
          <p className="text-muted-foreground mt-1">
            Manage existing product features with demos and guides
          </p>
        </div>
        <Button onClick={handleAdd} data-testid="button-add-feature">
          <Plus className="w-4 h-4 mr-2" />
          Add Feature
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading features...</div>
      ) : features.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No features yet. Click "Add Feature" to create one.
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Video Demo</TableHead>
                <TableHead>Help Guide</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.map((feature) => (
                <TableRow key={feature.id} data-testid={`row-feature-${feature.id}`}>
                  <TableCell className="font-medium">{feature.name}</TableCell>
                  <TableCell className="max-w-md">
                    <div className="line-clamp-2">{feature.description || "—"}</div>
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
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input
                placeholder="Feature name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-feature-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Brief description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                data-testid="input-feature-description"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Video Link (Demo)</label>
              <Input
                placeholder="https://..."
                value={formData.videoLink}
                onChange={(e) => setFormData({ ...formData, videoLink: e.target.value })}
                data-testid="input-feature-videolink"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Help Guide Link</label>
              <Input
                placeholder="https://..."
                value={formData.helpGuideLink}
                onChange={(e) => setFormData({ ...formData, helpGuideLink: e.target.value })}
                data-testid="input-feature-helpguidelink"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select
                value={formData.categoryId}
                onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
              >
                <SelectTrigger data-testid="select-feature-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button onClick={handleSubmitAdd} disabled={addMutation.isPending} data-testid="button-submit-add">
              {addMutation.isPending ? "Adding..." : "Add Feature"}
            </Button>
          </DialogFooter>
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
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input
                placeholder="Feature name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Brief description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                data-testid="input-edit-description"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Video Link (Demo)</label>
              <Input
                placeholder="https://..."
                value={formData.videoLink}
                onChange={(e) => setFormData({ ...formData, videoLink: e.target.value })}
                data-testid="input-edit-videolink"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Help Guide Link</label>
              <Input
                placeholder="https://..."
                value={formData.helpGuideLink}
                onChange={(e) => setFormData({ ...formData, helpGuideLink: e.target.value })}
                data-testid="input-edit-helpguidelink"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select
                value={formData.categoryId}
                onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
              >
                <SelectTrigger data-testid="select-edit-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button onClick={handleSubmitEdit} disabled={editMutation.isPending} data-testid="button-submit-edit">
              {editMutation.isPending ? "Updating..." : "Update Feature"}
            </Button>
          </DialogFooter>
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
