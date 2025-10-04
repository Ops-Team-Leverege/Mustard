import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  meetingDate?: string;
  transcript: string;
  leverageTeam: string;
  customerNames: string;
  customers?: Customer[];
  companyDescription?: string;
  numberOfStores?: string;
  serviceTags?: string[];
  contactJobTitle?: string;
  mainMeetingTakeaways?: string;
}

const LEVEREGE_TEAM_OPTIONS = [
  "Calum McClelland",
  "Hannah White",
  "Steven Lee",
  "Corey Redd",
  "Julia Conn",
  "Eric Conn",
  "Ryan Chacon",
  "Kevin Moran"
];

export default function TranscriptForm({ onSubmit, isAnalyzing = false }: TranscriptFormProps) {
  const [formData, setFormData] = useState<TranscriptData>({
    companyName: '',
    name: '',
    meetingDate: '',
    transcript: '',
    leverageTeam: '',
    customerNames: '',
    companyDescription: '',
    numberOfStores: '',
    serviceTags: [],
    contactJobTitle: '',
    mainMeetingTakeaways: '',
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [newCustomer, setNewCustomer] = useState<Customer>({ name: '', nameInTranscript: '', jobTitle: '' });
  const [companySearchOpen, setCompanySearchOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [teamSearchValue, setTeamSearchValue] = useState('');
  const [existingContactOpen, setExistingContactOpen] = useState(false);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const { data: companyContacts = [] } = useQuery<any[]>({
    queryKey: ['/api/contacts/company', selectedCompanyId],
    enabled: !!selectedCompanyId,
  });

  const handleAddCustomer = () => {
    if (!newCustomer.name.trim()) return;
    setCustomers([...customers, newCustomer]);
    setNewCustomer({ name: '', nameInTranscript: '', jobTitle: '' });
  };

  const handleAddExistingContact = (contact: any) => {
    // Check if contact is already added
    const alreadyAdded = customers.some(c => c.name === contact.name);
    if (alreadyAdded) return;
    
    const newContactData: Customer = {
      name: contact.name,
      nameInTranscript: contact.nameInTranscript || '',
      jobTitle: contact.jobTitle || '',
    };
    setCustomers([...customers, newContactData]);
    setExistingContactOpen(false);
  };

  const handleRemoveCustomer = (index: number) => {
    setCustomers(customers.filter((_, i) => i !== index));
  };

  const handleUpdateCustomer = (index: number, field: keyof Customer, value: string) => {
    const updatedCustomers = [...customers];
    updatedCustomers[index] = { ...updatedCustomers[index], [field]: value };
    setCustomers(updatedCustomers);
  };

  const handleAddTeamMember = (name: string) => {
    if (name.trim() && !teamMembers.includes(name.trim())) {
      setTeamMembers([...teamMembers, name.trim()]);
      setTeamSearchValue('');
    }
  };

  const handleRemoveTeamMember = (name: string) => {
    setTeamMembers(teamMembers.filter(m => m !== name));
  };

  const availableTeamOptions = LEVEREGE_TEAM_OPTIONS.filter(
    option => !teamMembers.includes(option)
  );

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
    
    if (teamMembers.length === 0) {
      return;
    }
    
    // Convert customers array to comma-separated names for backward compatibility
    const customerNames = customers.map(c => c.name).join(', ');
    const leverageTeamString = teamMembers.join(', ');
    
    const submissionData = {
      ...formData,
      leverageTeam: leverageTeamString,
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
                              numberOfStores: company.numberOfStores || '',
                              serviceTags: company.serviceTags || []
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
            <Label htmlFor="meetingDate" data-testid="label-meeting-date">Meeting Date</Label>
            <Input
              id="meetingDate"
              type="date"
              data-testid="input-meeting-date"
              value={formData.meetingDate}
              onChange={(e) => setFormData({ ...formData, meetingDate: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Optional date when the meeting took place
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
            <Label data-testid="label-leverage-team">Leverege Team Members <span className="text-destructive">*</span></Label>
            
            <Popover open={teamSearchOpen} onOpenChange={setTeamSearchOpen}>
              <PopoverTrigger asChild>
                <div 
                  className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer hover-elevate"
                  data-testid="button-team-selector"
                >
                  {teamMembers.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {teamMembers.map((member) => (
                        <Badge 
                          key={member} 
                          variant="secondary" 
                          className="gap-1"
                          data-testid={`badge-team-${member.replace(/\s+/g, '-').toLowerCase()}`}
                        >
                          {member}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveTeamMember(member);
                            }}
                            className="ml-1 hover:text-destructive"
                            data-testid={`button-remove-team-${member.replace(/\s+/g, '-').toLowerCase()}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Select team members...</span>
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput 
                    placeholder="Search or type name..." 
                    value={teamSearchValue}
                    onValueChange={setTeamSearchValue}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && teamSearchValue.trim()) {
                        e.preventDefault();
                        handleAddTeamMember(teamSearchValue);
                        setTeamSearchOpen(false);
                      }
                    }}
                    data-testid="input-team-search"
                  />
                  <CommandList>
                    {availableTeamOptions.length === 0 && !teamSearchValue.trim() ? (
                      <CommandEmpty>All team members selected</CommandEmpty>
                    ) : (
                      <>
                        {teamSearchValue.trim() && !LEVEREGE_TEAM_OPTIONS.includes(teamSearchValue.trim()) && (
                          <CommandGroup heading="Custom">
                            <CommandItem
                              onSelect={() => {
                                handleAddTeamMember(teamSearchValue);
                                setTeamSearchOpen(false);
                              }}
                              data-testid="option-team-custom"
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add "{teamSearchValue}"
                            </CommandItem>
                          </CommandGroup>
                        )}
                        {availableTeamOptions.length > 0 && (
                          <CommandGroup heading="Team Members">
                            {availableTeamOptions.map((member) => (
                              <CommandItem
                                key={member}
                                value={member}
                                onSelect={() => {
                                  handleAddTeamMember(member);
                                  setTeamSearchOpen(false);
                                }}
                                data-testid={`option-team-${member.replace(/\s+/g, '-').toLowerCase()}`}
                              >
                                <User className="mr-2 h-4 w-4" />
                                {member}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            
            <p className="text-xs text-muted-foreground">
              Select from the list or type a custom name
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

            {selectedCompanyId && companyContacts.length > 0 && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or</span>
                </div>
              </div>
            )}

            {selectedCompanyId && companyContacts.length > 0 && (
              <Popover open={existingContactOpen} onOpenChange={setExistingContactOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={existingContactOpen}
                    className="w-full justify-between"
                    data-testid="button-add-existing-contact"
                  >
                    Add an existing contact
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput 
                      placeholder="Search contacts..." 
                      data-testid="input-existing-contact-search"
                    />
                    <CommandList>
                      <CommandEmpty>No contacts found</CommandEmpty>
                      <CommandGroup>
                        {companyContacts
                          .filter(contact => !customers.some(c => c.name === contact.name))
                          .map((contact) => (
                            <CommandItem
                              key={contact.id}
                              value={contact.name}
                              onSelect={() => handleAddExistingContact(contact)}
                              data-testid={`option-existing-contact-${contact.id}`}
                            >
                              <User className="mr-2 h-4 w-4" />
                              <div className="flex flex-col">
                                <span>{contact.name}</span>
                                {contact.jobTitle && (
                                  <span className="text-xs text-muted-foreground">{contact.jobTitle}</span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}

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
              placeholder="Include what services they provide, any operational differences than what we normally see, whether it's corporate or franchise owned, and anything else that would be hard to discover online"
              className="min-h-[100px]"
              value={formData.companyDescription}
              onChange={(e) => setFormData({ ...formData, companyDescription: e.target.value })}
            />
          </div>

          <div className="space-y-3">
            <Label data-testid="label-service-tags">Service Tags</Label>
            <div className="space-y-2">
              {["tire services", "oil & express services", "commercial truck services", "full services"].map((tag) => (
                <div key={tag} className="flex items-center space-x-2">
                  <Checkbox
                    id={`service-tag-${tag}`}
                    checked={formData.serviceTags?.includes(tag)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFormData({ ...formData, serviceTags: [...(formData.serviceTags || []), tag] });
                      } else {
                        setFormData({ ...formData, serviceTags: formData.serviceTags?.filter(t => t !== tag) || [] });
                      }
                    }}
                    data-testid={`checkbox-service-tag-${tag}`}
                  />
                  <Label htmlFor={`service-tag-${tag}`} className="text-sm font-normal cursor-pointer">
                    {tag}
                  </Label>
                </div>
              ))}
            </div>
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
            <Label htmlFor="mainMeetingTakeaways" data-testid="label-main-meeting-takeaways">Main Meeting Takeaways</Label>
            <Textarea
              id="mainMeetingTakeaways"
              data-testid="input-main-meeting-takeaways"
              placeholder="Summarize the key takeaways from this meeting..."
              className="min-h-[100px]"
              value={formData.mainMeetingTakeaways}
              onChange={(e) => setFormData({ ...formData, mainMeetingTakeaways: e.target.value })}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isAnalyzing || customers.length === 0 || !formData.companyName.trim() || !formData.transcript.trim() || teamMembers.length === 0}
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
