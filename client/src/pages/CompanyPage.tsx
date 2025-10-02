import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ProductInsightsTable from "@/components/ProductInsightsTable";
import QATable from "@/components/QATable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X, Plus, Trash2, User } from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CompanyOverview, Contact } from "@shared/schema";

export default function CompanyPage() {
  const params = useParams();
  const companySlug = params.slug;
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    companyDescription: '',
    mainInterestAreas: '',
    numberOfStores: '',
  });

  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', jobTitle: '' });
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactForm, setEditContactForm] = useState({ name: '', jobTitle: '' });

  const { data: overview, isLoading } = useQuery<CompanyOverview>({
    queryKey: [`/api/companies/${companySlug}/overview`],
    enabled: !!companySlug,
  });

  const { data: categories = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ['/api/categories'],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { companyDescription: string; mainInterestAreas: string; numberOfStores: string }) => {
      if (!overview?.company.id) throw new Error("Company not found");
      const res = await apiRequest('PATCH', `/api/companies/${overview.company.id}`, {
        name: overview.company.name,
        notes: overview.company.notes,
        companyDescription: data.companyDescription,
        mainInterestAreas: data.mainInterestAreas,
        numberOfStores: data.numberOfStores,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Company details updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update company details",
        variant: "destructive",
      });
    },
  });

  const createContactMutation = useMutation({
    mutationFn: async (data: { name: string; jobTitle: string }) => {
      if (!overview?.company.id) throw new Error("Company not found");
      const res = await apiRequest('POST', '/api/contacts', {
        name: data.name,
        jobTitle: data.jobTitle || null,
        companyId: overview.company.id,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      setIsAddingContact(false);
      setNewContact({ name: '', jobTitle: '' });
      toast({
        title: "Success",
        description: "Contact added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add contact",
        variant: "destructive",
      });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ id, name, jobTitle }: { id: string; name: string; jobTitle: string }) => {
      const res = await apiRequest('PATCH', `/api/contacts/${id}`, {
        name,
        jobTitle: jobTitle || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      setEditingContactId(null);
      setEditContactForm({ name: '', jobTitle: '' });
      toast({
        title: "Success",
        description: "Contact updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update contact",
        variant: "destructive",
      });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/contacts/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/companies');
        }
      });
      toast({
        title: "Success",
        description: "Contact deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete contact",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Company Not Found</CardTitle>
            <CardDescription>The requested company does not exist.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleStartEdit = () => {
    setEditForm({
      companyDescription: overview?.company.companyDescription || '',
      mainInterestAreas: overview?.company.mainInterestAreas || '',
      numberOfStores: overview?.company.numberOfStores || '',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editForm);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({
      companyDescription: '',
      mainInterestAreas: '',
      numberOfStores: '',
    });
  };

  const handleAddContact = () => {
    if (!newContact.name.trim()) return;
    createContactMutation.mutate(newContact);
  };

  const handleStartEditContact = (contact: Contact) => {
    setEditingContactId(contact.id);
    setEditContactForm({ name: contact.name, jobTitle: contact.jobTitle || '' });
  };

  const handleSaveContact = () => {
    if (!editingContactId || !editContactForm.name.trim()) return;
    updateContactMutation.mutate({
      id: editingContactId,
      name: editContactForm.name,
      jobTitle: editContactForm.jobTitle,
    });
  };

  const handleCancelEditContact = () => {
    setEditingContactId(null);
    setEditContactForm({ name: '', jobTitle: '' });
  };

  const handleDeleteContact = (id: string) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      deleteContactMutation.mutate(id);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <Card>
        <CardHeader>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-2xl sm:text-3xl">{overview.company.name}</CardTitle>
                {overview.company.notes && (
                  <CardDescription className="mt-2">{overview.company.notes}</CardDescription>
                )}
              </div>
              {!isEditing ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleStartEdit}
                  data-testid="button-edit-company"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-company"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCancel}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-edit"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <Badge variant="secondary" data-testid="badge-transcript-count">
                {overview.transcriptCount} {overview.transcriptCount === 1 ? 'Transcript' : 'Transcripts'}
              </Badge>
              <Badge variant="secondary" data-testid="badge-insight-count">
                {overview.insightCount} {overview.insightCount === 1 ? 'Insight' : 'Insights'}
              </Badge>
              <Badge variant="secondary" data-testid="badge-qa-count">
                {overview.qaCount} Q&A {overview.qaCount === 1 ? 'Pair' : 'Pairs'}
              </Badge>
            </div>

            <div className="space-y-4">
              {!isEditing ? (
                <>
                  {overview.company.companyDescription && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Company Description</h3>
                      <p className="text-sm text-muted-foreground" data-testid="text-company-description">
                        {overview.company.companyDescription}
                      </p>
                    </div>
                  )}
                  {overview.company.mainInterestAreas && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Main Interest Areas</h3>
                      <p className="text-sm text-muted-foreground" data-testid="text-main-interest-areas">
                        {overview.company.mainInterestAreas}
                      </p>
                    </div>
                  )}
                  {overview.company.numberOfStores && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Number of Stores</h3>
                      <p className="text-sm text-muted-foreground" data-testid="text-number-of-stores">
                        {overview.company.numberOfStores}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Company Description</h3>
                    <Textarea
                      value={editForm.companyDescription}
                      onChange={(e) => setEditForm({ ...editForm, companyDescription: e.target.value })}
                      placeholder="Describe the company..."
                      className="min-h-[80px]"
                      data-testid="input-company-description"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Main Interest Areas</h3>
                    <Textarea
                      value={editForm.mainInterestAreas}
                      onChange={(e) => setEditForm({ ...editForm, mainInterestAreas: e.target.value })}
                      placeholder="Main product features or areas of interest..."
                      className="min-h-[80px]"
                      data-testid="input-main-interest-areas"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Number of Stores</h3>
                    <Input
                      value={editForm.numberOfStores}
                      onChange={(e) => setEditForm({ ...editForm, numberOfStores: e.target.value })}
                      placeholder="e.g., 50 stores"
                      data-testid="input-number-of-stores"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Contacts</CardTitle>
              <CardDescription>
                Customer contacts from {overview.company.name}
              </CardDescription>
            </div>
            {!isAddingContact && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsAddingContact(true)}
                data-testid="button-add-contact"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Contact
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {isAddingContact && (
              <div className="border rounded-md p-4 space-y-3 bg-muted/30">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Name</label>
                    <Input
                      value={newContact.name}
                      onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                      placeholder="Contact name"
                      data-testid="input-contact-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Job Title</label>
                    <Input
                      value={newContact.jobTitle}
                      onChange={(e) => setNewContact({ ...newContact, jobTitle: e.target.value })}
                      placeholder="e.g., VP of Engineering"
                      data-testid="input-contact-job-title"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddContact}
                    disabled={!newContact.name.trim() || createContactMutation.isPending}
                    data-testid="button-save-contact"
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Save Contact
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsAddingContact(false);
                      setNewContact({ name: '', jobTitle: '' });
                    }}
                    disabled={createContactMutation.isPending}
                    data-testid="button-cancel-add-contact"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {overview.contacts && overview.contacts.length > 0 ? (
              <div className="space-y-2">
                {overview.contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between gap-4 p-3 border rounded-md hover-elevate"
                    data-testid={`contact-${contact.id}`}
                  >
                    {editingContactId === contact.id ? (
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          value={editContactForm.name}
                          onChange={(e) => setEditContactForm({ ...editContactForm, name: e.target.value })}
                          placeholder="Contact name"
                          data-testid={`input-edit-contact-name-${contact.id}`}
                        />
                        <Input
                          value={editContactForm.jobTitle}
                          onChange={(e) => setEditContactForm({ ...editContactForm, jobTitle: e.target.value })}
                          placeholder="Job title"
                          data-testid={`input-edit-contact-job-title-${contact.id}`}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-1">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate" data-testid={`text-contact-name-${contact.id}`}>
                            {contact.name}
                          </p>
                          {contact.jobTitle && (
                            <p className="text-sm text-muted-foreground truncate" data-testid={`text-contact-job-title-${contact.id}`}>
                              {contact.jobTitle}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-1 flex-shrink-0">
                      {editingContactId === contact.id ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={handleSaveContact}
                            disabled={!editContactForm.name.trim() || updateContactMutation.isPending}
                            data-testid={`button-save-edit-contact-${contact.id}`}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={handleCancelEditContact}
                            disabled={updateContactMutation.isPending}
                            data-testid={`button-cancel-edit-contact-${contact.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleStartEditContact(contact)}
                            data-testid={`button-edit-contact-${contact.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteContact(contact.id)}
                            disabled={deleteContactMutation.isPending}
                            data-testid={`button-delete-contact-${contact.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !isAddingContact && (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No contacts added yet</p>
                  <p className="text-sm mt-1">Click "Add Contact" to add customer contacts</p>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product Insights</CardTitle>
          <CardDescription>
            Feature requests and product feedback from {overview.company.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductInsightsTable 
            insights={overview.insights.map(i => ({
              ...i,
              category: i.categoryName || 'NEW',
            }))}
            categories={categories}
            defaultCompany={overview.company.name}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Q&A Pairs</CardTitle>
          <CardDescription>
            Questions and answers from {overview.company.name} calls
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QATable 
            qaPairs={overview.qaPairs.map(qa => ({
              ...qa,
              category: qa.categoryName || 'NEW',
            }))}
            categories={categories}
            defaultCompany={overview.company.name}
          />
        </CardContent>
      </Card>
    </div>
  );
}
