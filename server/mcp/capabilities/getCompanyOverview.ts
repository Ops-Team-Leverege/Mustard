import { answerQuestion } from '../../rag'
import type { MCPContext } from '../context'
import type { CompanyOverviewInput } from '../types'

export async function handler(
  ctx: MCPContext,
  input: CompanyOverviewInput
) {
  return answerQuestion({
    question: input.question,
    companyId: input.companyId,
    mode: 'summary'
  })
}
