import { getCompanyOverview } from "./getCompanyOverview";
import { getCompanyInsights } from "./getCompanyInsights";
import { getCompanyQuestions } from "./getCompanyQuestions";
import { searchCompanyFeedback } from "./searchCompanyFeedback";
import { searchQuestions } from "./searchQuestions";
import { countCompaniesByTopic } from "./countCompaniesByTopic";

export const capabilities = [
  getCompanyOverview,
  getCompanyInsights,
  getCompanyQuestions,
  searchCompanyFeedback,
  searchQuestions,
  countCompaniesByTopic,
];
