import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2, Plus, X, User, Check, ChevronsUpDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Company } from "@shared/schema";
import { cn } from "@/lib/utils";

interface TranscriptFormProps {
  onSubmit?: (data: TranscriptData) => void;
  isAnalyzing?: boolean;
}

export interface Customer {
  name: string;
  nameInTranscript?: string;
  jobTitle: string;
}

export interface TranscriptData {
  companyName: string;
  name?: string;
  transcript: string;
  leverageTeam: string;
  customerNames: string;
  customers?: Customer[];
  companyDescription?: string;
  numberOfStores?: string;
  contactJobTitle?: string;
  mainInterestAreas?: string;
}

export default function TranscriptForm({ onSubmit, isAnalyzing = false }: TranscriptFormProps) {
  const [formData, setFormData] = useState<TranscriptData>({
    companyName: '',
    name: '',
    transcript: '',
    leverageTeam: '',
    customerNames: '',
    companyDescription: '',
    numberOfStores: '',
    contactJobTitle: '',
    mainInterestAreas: '',
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [newCustomer, setNewCustomer] = useState<Customer>({ name: '', nameInTranscript: '', jobTitle: '' });
  const [companySearchOpen, setCompanySearchOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const { data: companyContacts = [] } = useQuery<any[]>({
    queryKey: ['/api/contacts/company', selectedCompanyId],
    enabled: !!selectedCompanyId,
  });

  // Load contacts when a company is selected
  useEffect(() => {
    if (companyContacts.length > 0) {
      const contactsAsCustomers = companyContacts.map(contact => ({
        name: contact.name,
        nameInTranscript: contact.nameInTranscript || '',
        jobTitle: contact.jobTitle || '',
      }));
      setCustomers(contactsAsCustomers);
    }
  }, [companyContacts]);

  const handleAddCustomer = () => {
    if (!newCustomer.name.trim()) return;
    setCustomers([...customers, newCustomer]);
    setNewCustomer({ name: '', nameInTranscript: '', jobTitle: '' });
  };

  const handleRemoveCustomer = (index: number) => {
    setCustomers(customers.filter((_, i) => i !== index));
  };

  const handleUpdateCustomer = (index: number, field: keyof Customer, value: string) => {
    const updatedCustomers = [...customers];
    updatedCustomers[index] = { ...updatedCustomers[index], [field]: value };
    setCustomers(updatedCustomers);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.companyName.trim()) {
      return;
    }
    
    if (customers.length === 0) {
      return;
    }
    
    if (!formData.transcript.trim()) {
      return;
    }
    
    if (!formData.leverageTeam.trim()) {
      return;
    }
    
    // Convert customers array to comma-separated names for backward compatibility
    const customerNames = customers.map(c => c.name).join(', ');
    
    const submissionData = {
      ...formData,
      customerNames,
      customers,
    };
    
    console.log('Transcript submitted:', submissionData);
    onSubmit?.(submissionData);
  };

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">Add New Transcript</CardTitle>
        <CardDescription>
          Upload BD call transcript to extract product insights and customer questions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label data-testid="label-company-name">Company Name <span className="text-destructive">*</span></Label>
            <Popover open={companySearchOpen} onOpenChange={setCompanySearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={companySearchOpen}
                  className="w-full justify-between"
                  data-testid="button-company-selector"
                >
                  {formData.companyName || "Select or enter company name..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput 
                    placeholder="Search or type new company..." 
                    value={formData.companyName}
                    onValueChange={(value) => setFormData({ ...formData, companyName: value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setCompanySearchOpen(false);
                      }
                    }}
                    data-testid="input-company-search"
                  />
                  <CommandList>
                    <CommandEmpty>
                      Press Enter to use "{formData.companyName}"
                    </CommandEmpty>
                    <CommandGroup>
                      {companies.map((company) => (
                        <CommandItem
                          key={company.id}
                          value={company.name}
                          onSelect={() => {
                            setFormData({ 
                              ...formData, 
                              companyName: company.name,
                              companyDescription: company.companyDescription || '',
                              mainInterestAreas: company.mainInterestAreas || '',
                              numberOfStores: company.numberOfStores || ''
                            });
                            setSelectedCompanyId(company.id);
                            setCompanySearchOpen(false);
                          }}
                          data-testid={`option-company-${company.id}`}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              formData.companyName === company.name ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {company.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Select an existing company or type a new one
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meetingName" data-testid="label-meeting-name">Meeting Name</Label>
            <Input
              id="meetingName"
              data-testid="input-meeting-name"
              placeholder="e.g., BD Intro Call, Weekly Customer Meeting, User Interview"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Optional name to identify this transcript
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transcript" data-testid="label-transcript">Transcript <span className="text-destructive">*</span></Label>
            <Textarea
              id="transcript"
              data-testid="input-transcript"
              placeholder="Paste the full BD call transcript here..."
              className="min-h-[200px] font-mono text-sm"
              value={formData.transcript}
              onChange={(e) => setFormData({ ...formData, transcript: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="leverageTeam" data-testid="label-leverage-team">Leverege Team Members <span className="text-destructive">*</span></Label>
            <Input
              id="leverageTeam"
              data-testid="input-leverage-team"
              placeholder="e.g., John Smith, Sarah Johnson"
              value={formData.leverageTeam}
              onChange={(e) => setFormData({ ...formData, leverageTeam: e.target.value })}
              required
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of Leverege team members on the call
            </p>
          </div>

          <div className="space-y-3">
            <Label data-testid="label-customers">Customer Attendees <span className="text-destructive">*</span></Label>
            
            <div className="border rounded-md p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,1fr,auto] gap-3 items-end">
                <div>
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <Input
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    placeholder="e.g., Mike Chen"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomer();
                      }
                    }}
                    data-testid="input-new-customer-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Name in Transcript (optional)</label>
                  <Input
                    value={newCustomer.nameInTranscript}
                    onChange={(e) => setNewCustomer({ ...newCustomer, nameInTranscript: e.target.value })}
                    placeholder="e.g., Mike"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomer();
                      }
                    }}
                    data-testid="input-new-customer-name-in-transcript"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Job Title (optional)</label>
                  <Input
                    value={newCustomer.jobTitle}
                    onChange={(e) => setNewCustomer({ ...newCustomer, jobTitle: e.target.value })}
                    placeholder="e.g., VP of Operations"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomer();
                      }
                    }}
                    data-testid="input-new-customer-job-title"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddCustomer}
                  disabled={!newCustomer.name.trim()}
                  data-testid="button-add-customer"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            {customers.length > 0 ? (
              <div className="space-y-3">
                {customers.map((customer, index) => (
                  <div
                    key={index}
                    className="border rounded-md p-3 bg-background space-y-3"
                    data-testid={`customer-item-${index}`}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,1fr,auto] gap-3 items-end">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Name</label>
                        <Input
                          value={customer.name}
                          onChange={(e) => handleUpdateCustomer(index, 'name', e.target.value)}
                          placeholder="e.g., Mike Chen"
                          data-testid={`input-customer-name-${index}`}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Name in Transcript (optional)</label>
                        <Input
                          value={customer.nameInTranscript || ''}
                          onChange={(e) => handleUpdateCustomer(index, 'nameInTranscript', e.target.value)}
                          placeholder="e.g., Mike"
                          data-testid={`input-customer-name-in-transcript-${index}`}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Job Title (optional)</label>
                        <Input
                          value={customer.jobTitle || ''}
                          onChange={(e) => handleUpdateCustomer(index, 'jobTitle', e.target.value)}
                          placeholder="e.g., VP of Operations"
                          data-testid={`input-customer-job-title-${index}`}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveCustomer(index)}
                        data-testid={`button-remove-customer-${index}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Add at least one customer who attended this call
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="companyDescription" data-testid="label-company-description">Company Description</Label>
            <Textarea
              id="companyDescription"
              data-testid="input-company-description"
              placeholder="Describe the company, their business model, and key details..."
              className="min-h-[100px]"
              value={formData.companyDescription}
              onChange={(e) => setFormData({ ...formData, companyDescription: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="numberOfStores" data-testid="label-number-of-stores">Number of Stores</Label>
            <Input
              id="numberOfStores"
              data-testid="input-number-of-stores"
              placeholder="e.g., 150 or Not applicable"
              value={formData.numberOfStores}
              onChange={(e) => setFormData({ ...formData, numberOfStores: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mainInterestAreas" data-testid="label-main-interest-areas">Main Interest Areas in Product</Label>
            <Textarea
              id="mainInterestAreas"
              data-testid="input-main-interest-areas"
              placeholder="Describe the main product features or areas they're interested in..."
              className="min-h-[100px]"
              value={formData.mainInterestAreas}
              onChange={(e) => setFormData({ ...formData, mainInterestAreas: e.target.value })}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isAnalyzing || customers.length === 0 || !formData.companyName.trim() || !formData.transcript.trim() || !formData.leverageTeam.trim()}
            data-testid="button-analyze-transcript"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Analyze Transcript
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
