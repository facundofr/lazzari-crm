/**
 * Professional PDF templates for all document types.
 * Generates print-ready HTML for Argentine business documents.
 *
 * Usage: each function returns an HTML string. Open in a new window and call print().
 */

import { formatCurrency, formatDate } from "@/lib/utils";
import { readFceMetadata, importeEnLetras } from "@/lib/fce-invoice";
import { scopePdfStyles } from "@/lib/pdf-style-scope";

// ── Sociedad info (static data not in the Sociedad type) ─────────
interface SociedadPDF {
  nombre: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
  colorPrimario: string;
  domicilio: string;
  telefono: string;
  email: string;
  commercialEmail: string;
  web: string;
  inicioActividades: string;
  ingresosBrutos: string;
  jurisdiccion: string;
}

// Logo Lazzari 150px (base64 embedded for offline PDF printing)
const LAZZARI_LOGO_B64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAAB/CAYAAACql41TAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAyKADAAQAAAABAAAAfwAAAAA5vOmRAABAAElEQVR4Ae1dB4CVxbX++3/vf8t2FthCFxSxgQVbQKPGAiLJYvdpNPjyEvOeJlFT1LXEqDGa9pJIjJLYWVGKkcSXBBJbNIiiLoK0BYRdWLbf9vf3nfn3LneXLXcLILt3YO/fppw5c87MOWfOzPBcJhwUDNScWxjw884IVxBKHd4u5AVuhGBZOY4vaPOiaFqOa7s2bwuuZbqca0uOY9mOZXEu73A85wo853Cu4xgiwHVsN4Afw8aDIrq1Wsm6I55f8yHP8+5BqcwQKkQaQnU9JFWtLJusDNu7e4wk6dMlR5zFW/GTJM7O4V3LLzic4BgJzuF5wAbadl2XmIEROiN1POMfPrvsh3dd1RJcEbxErCAJkmM5YiXvNv2AZXFIaji4C6WWyYQDhIGac48J8HLt6SEr8k3ZMs+WXNuPwYEDE2A4ENiVCB30DwgYR3iXVn6heOx1spVcpKHgOJwjSU5czFoXz8q+vWDRp69ymdHDw80A/2ZGkAFGaDK79bMnhkS3fpaWiN7v5+KjOEviHBKPICsJtgD2IKq3ITuBYTh8SBI/ZdDKKx2vDoYcHtFdSbQtUXs/Ehhx2/CKtSszzEFIOzAh2TcdmNyHaK4brxwfzqmLXKI50Qf8dmw4VAfISeiLHFImmBQFKsc1iX2X5KrOkJV8meQYxOF5MyZrq1v8xbeOfPnjN/Ei5WNneWTe9QcDyRboTx6ZtCkYaJgxOtvS9EtDVtO9qqUXuA4+kjTlEB23ohuXJEPw7KYzGodWDg4SwFyUzMHIw3OSnhDUNxoLRtw28tlP1mSYIwXxB+g2wyADiNim88K5gitfqVrm3TIfz4GhaR9T9LYcV+Qs0eFEYhCwhitKCUPWVtaGS24tfeHDj3ubXSZ+3zDQqvX1LXEm1T4MfHJJUZ4jSNf5nJb7JCGaQ2JV24ixL1rad6SbiDZEM2IOgY8nxNBfq/PG3ZxhjrRROCARM0r6AKARcxzDJNO+NmAa35dcM2xCLZBI8e5HcJCHiMkSR+RjcSX8f3sCI+4Y9/TqDf3IMpO0DxjIMEgfkJaapOq8I0eo/J7/0hKxb8uO7XcdgRNpXE5ROVLjp3svIB+YcqMROfDnutC474974d1P002biTdwGMgwSD9wueOiI4qynIZvaUbL/4iOqdCUNyb5YFcCh8AkS5aqtMQsUsLJpEWWLSjt7JYXWuJScHlT9qQ7xj37xpZ+gJlJ2g8MZBikj8jbPGtyqebU3+zXo9+kvp7MUt7cBmVIzEHX9GwgLhgKk+Rto44tyI0Jwb90d3DSnWCO7ZRTJhwaDKTXgocGts9tqbsuGDMqy26+TXEiN4qWheGCev1WAu8D1C5Yi1yuMEUCnUOub5L9zzQVjr9/zMJ/1/Qhu0ySAcQAScuZkD4G+G0Xlo4Nc5E7fFbL1yVbB/48xsBv3wOmx8nXCsyxNy6Hn6wbf8oPM8zRd3QOZMqMiJUmNkk9qJ1VPD5oNtyhWPrVNIFHJlgmRtHseJ84hNJTQlwFtTYqBX+34+Qzfzy5vCKSJliZaAcYA5kRJD0E87vnHjk5ZDXfo9rxq0UXXujgGLiue0o1I/I0OYRxEkYLkqcokCkXzNEkh/7340ln3pdhDg8tn5ffDIP00BIgY77u4slHavGG+32mcRlP3ritliYyVLGhg7mLpKfOkb5B/MTDjEtKhyPINQ1y8DcvXnz3/ac+WhHvAZzM54OMgf7NZh1kYA92cW45J3yWN3GKltj9UMBqupDDyMGYI03rVGfwMl4it17wBy67Ikrwl7knf/PBad/5jtlZ/My7Q4uB9Lq9QwvjISl9UVmZeHrsjeNClv5A0Ip8keMMtoYDa/48i1UfoaIZct6VOFMRtsdE7ZH/O+lbv5lXXm70Jru1WGcySqwZ7hhmgLjK5ZU05bv9SwnAgBbFBI6C+gmqEt2p5e+ZXFGZ0YFaUZVhkP1phiPmOCv++tSAFX3IZ8a+wNlAEwgbroPQO+AjRaJVHwOJWHA63Gqo2fc/sqzqiXIe9t00gzufk/duzx/rd4WTBN68CItuR2MOhezDpNKkzyReq7f62MNOw/Qig3dkeZvuKn9psQL/+ndW1cZ5FViwMsRDhkE6EIBbPkPa/d7GaSG9/hHNdqa7tKiJzXCDOWCOFchtnaa60wq0XlYE/ZHFCwFilSX4NzWEht9TeMzGZ7jy9Jljx3nFuRrXfJLKud+At/BZEmdpTJlJC46eIpGkDV4AoxicHDck///pcui+vGXbVw/1de4ZM28K7Wy9doavce1nJ0OkelizrWkcmAHdbKvGYXsdbW+YAzPkbJach9VLwEpyUdvQIuXdBeZ4sTfMsfmLI0t9glEWMO1vqW6ilOACNadA3t/b5EDBcwpn+xU3MhsrH3O2XHbcDch5SPuADSSW+9tKhzT9jrJif1D3neM36u5TreYpbKETDRb9garVugWVw4nL4rqIVHRH4fJNy5BrWmJVOcacGy7IH5/lJv7HZ5rXSLYTYG4s/YEpnbTkSyZzXKOa+7hjh76dt2JTczrJBmMcYCITdpRN9wej/Lm++J6fqGZkCpO8oXfQ7HZ/AvbwwfpxzjYF5eN6Jf+2wuWbl6TLHCtnzJD++6KiKblO7AG/rn9dcq0AiXgHPvAc7SZEi72C8cbLbCky1y0vH7J00j8KOPCtdcBL2DVrpKZw3DnBRPOPVTd+pAN9g/QMF5TNkJNeZ98pnA6POXdZXVPny7q7ZGnVCjAHU0U6jZzykrYKGm5FpqqJxvKAFT+XrMukxziwDghY136gAwOSHCgxERqThU17w2MvHlVRue5Al/t5zH/I9gzUGLSZm+rwF4YSTT9RnfiRbA4QbOFCEididAVQZi+Ct7+Vpzo7gmAmZN+71bmjvt0b5th4/ni1sGXvGf54/U8CRvxcziYYvJGjH7yadi3YhluIzRwoUa5mG+Ozo7W3vT/nuOy0MxlEEYcsg6yfnR8SRXeO32p5UHbNCd6ebdiAB9oBz1lsOYe3oUJ6rY2d3ZhIRsZgVxQM7DzyZn1wxC3jnlv7Rrojx8bzOXWYu2dG0Ik+6rNjp7E17Uk9CIMPfIbTA6Yfsdh6FKQXYFhgLvjAR8BovKzEbpzjwvzdj6wPy6RDkkG2zhmdXWhLc8NG84N+OzHGhuMhW+SU0oQeKaZHkNTrsslxTCK6oqwbgn/V3lDxzSWL172TkmW3t2wHRiF3hmpbj6i2PoUtaWcp0oOh28z78xEMKjq2Ekg0fL/GqZzUn6wOx7RDjkF2YOeR3Hj0Kr/e/ABmj4to4xGJmU3TUg86bWNiLubdK3Jxg/f/rSGQ8z9jKio/6DRyJy/d+VPlomj1F1Qj8SgY5CgOmzX0ZzKykyL69YpGR58bnRCO1dyyfvZpoX5ldpglHlJDZvPZRXmyYF0XtBJ3y5yRTxu5kdmUlsmi609XEurQxF4P74hKLKbKr8UKSm4Zvmhj2nMHKzEx6Vu//YygEf+Zz9UnY4NqzmZ7YJGo9zkK8DoWHPNIKch/qM1rXL9qlTf3+TmC8ICAMmRGkM+wLY8gx74G5ihHR59FOofnFwUWQeO7Yh9MqBCtaMoACnkkqgSW15VOvnnY05Wb0m2pcphPj1pTfXLYafmJz9GPBmswqiMzARm8kmMam05pzTR539m1s3eUjN735ts+1myFgDoQdCbYW9inNjfc/s0tx45It46He7whMYKsnjVVyzH2/mfIjpRLlqNRD922HANtTwTJFNI0+2yP2DyqcyWpGQudltYXTvn2mMff+CxdggDpCUflbJwS1Jt+rpktJ4GEWVJSxBk89JSch0FRbSF539WVIvbnG6VFucx/ABVl0OCZTl/gwSQKb43UDWdP2cyJ7y54rzqtCc822A/DmyHhajJK3HlSKNHyfcmxfeQQJWD0oJCkI6/d2j957/b/Zb0xSwsiEqWmZkFb3Dh87A/GLFyV9vpxcoZsjK8+OhCvfdhvG9OT3TuRoQeUBwv7TYKVvBJIyfuO14H4hjxI8kyOOBjIyBeS+WuKhDbcq3rTTeGG0F/wlLaeRaAdjmFIMIgai16mui7EKq+JqNH7Gry0mG2WuYYEr7yQGHnSnWOeXFHbm/zGqluGiZHoLX4nAZ1D2EUrE0GW+EtKvMn7jlcqpeO7fc+oFkg7Na993/blTXl4gfjAy4+e95VNfEcu+TSSOLwlAW9BdCpwIsYbGDQ0wSoaFmmYv6ds8q3DBrlr/OBnEJhghHOzxxPt0H6HQp9n24hsiARpcwWprtmX9VRs3Jn3ljxaUU/k1Zvgd6UcXXQ+Flz/WgmqjyWTpNsHHag3haYTFyB4a7kcTjJlsKLgwl1Gg7420ecY40SRG+Y6ejEc7H1+07jatON/Qrb0N2gDtfogDy7fck7ohSAXK3NNuJ7jGAKXT+w379E9Eoi5GG9wtiTWxuScJ+oKTnlgzMIljd2n6+lrUpDpKd6h+k7jpcuvvPY6dXL038WuFTkmGGu60ufGToI+UtwiqMs3Zk24elrFe02HCsIDXe7gH0HACnGp4PWAnZhLfT/OB2wT4XtCLrMjEQ2DTmhdhyvIu1tU/2MbRh//01N+uWQAPFz7I+z1BH1635nfV6Tax5voSFRHyLYw7Snxbq0j2lJ8tPGHGXcbM8sXJpAbWec2bbzujNfz6tfNC8Yjt2iucU6JufeLeL84vdIOv1iDdgR59fyTw8HhueqZ0A8+/fKUsaXNm/6iwq+IJr1o+V06E3FMWUWbipRGFj+Lifm/XR089eczKwbHtjy1OAWLs+vOzDKNUZDwJEcmxcMRYfF2DF6JJXipTlb5nbGE2qSpdk14+a69jMTLXaHpvaLL/FbTIwlXfe/tgmnzznvqtejhR/49QzxoR5BJ/l0z7KbmYUDB40cs/nBr5Lyc/5Ud7h702SHBTW8JOLN2YY7E8ik7G7TcBzeddsvvZ95yy6DYeYSYg7ciX9asxD3ARxG8hQXRJA9eMueS2dtwZF6M2a60O0uKbzMc/z92zhz5wpv5p22aV87bWWXuC83xoim+RPMto2LbjgSeV/dMbodfjKTp4vCDvAeIsyLRiwtbaq5fee21MO1CZBhx3G9blNB9hiquhwrKzPxM1qIxNDmOJu/ZlSYBJawfD7zd6B9+469f3PHrUwcJc+y8bFyJatfeFU7UP+ozEiW8awrkTi/YQItFgiWP1ffYIdg1gj4zPs6X0M/C2pDyArnh6Rmxt7z1IRW83eQv+FVcUndohlXcQ3Mctp8HLYMIolLl560p4xr/dia1DuYpEk05R/yuUQ7cYyjq06Yov4etPqtMQarFX7MlCFH48EYtXmwxML9hSkp9QlT+2aTl3/O/izevKO/F5gqfZ2qAo+bo7Mba7/oTsa/JrpXNVCw4WdIGdsxKR+YIWIdpqTCZxek7zX2Q34FsG9OyzMjtn73/x8lUx+JFa3c1KbkL45y4np4HY0j2nYOubrWzx07L1ne/luDl9+u00u+Ofmnt+5627fI7vjJufFZL7STZ5fIMUQxDLwlixbiCQ8s5i1ds16eaWDRl6iK3pmBp7SqYvsiIddiHHbNRb6P+O5oZvVJ0nSCrFH7IRkf3+4iBcUVrfb1vZKSAsAmGUbEUN/vX6yee8R3a6K7ymlmlR42duosvL6eFK4Mu7MPJIKvaWzdP9x/9yce/0Szjal3WlkWk4G8ivmHvjGtnknT5RYsqhOK3K5Ssz9YxtxvLh8Obx51g13KjnXnld2HbqcHBHFg5OSmYiN7qt+OXibzlp1GCp1EjySU9tD8bUbDlkQCnzqjor90+rOi0o579ZGMPyQ77z4OWQahl6mYVnRKI710OF4k8eNu+nZDEv5uCuEp0lE07svOb65S8+LDRM2i6+SCGym7KYpLLft+1qlVCVRVnzVy1qg+9tMvvOm/08Tl20y2yG/sKDA8qbWUkkAgF3k+X/aG6s5GGFlQ5suDUBkPnDH+57u/7ATvIXgxaKxa1U43v1DUjrL++mK1HbpSs+KnYFfEYvyR8wXaMzaPrmveMFqv2Krs/NmHOJVsV/qFHxTiCjpLTRZlT7eRuoEkewkbTiEO/FJJv2UOaP/CTZH12++iUE3J1/9bWYZFGAC9jnAXqiDFZbR5eWvISXtW1T9fzU/WcsSdmxepvVxxzFnKTaFkwfAsABO3XlS6/ASwGGeAEg0CFF0Sb9/dc+uEfY1AzyOSKCgNK6WMQs76EVXqjZdsNcrxxBhr3DIm3EqDAKDajRqsTgWIVNhEBE6rg2o25ErY5dbKN4aLi0poRRikUv/XWu2v/2wkLJCO0cUDyBa60TJdxJsubiJbYA4HY1hF1XvL9TvGxxene+7R+Xb7+nFGnBmJ7b5cs/QI2+0OFQ/Nmnss8Kkq++gygbgBmZQEXNOIALtrI0XYkyxVzMXvuTYukBc5hGmlQMwi1yegrHvqoceG3/iA55g9hy4T10lM20Zv64KLq49icCBEI61PZldK18gxuGFWxV30bM1qT9nRhxeCHDtPBP3T0AA+TEaL/aU6Rnh63oHfuHPWzJp4WSDTdITrxc7ATCjaTh5CEagrMLEW1RaAyvTu66Sa0Dns0esAhKyqqa6JZIzcNhT3lWruqbnBzmH/i583DFHD2QouXP+KJ+Ijykg6LzL032XsyakFt6Yo/Rkgd3h0wXKBnZrBg9EC5NNuPWQgrLgSWNOQMe7Bw8fYt6RcNnePckjP9ido7JDd+DuY3WCVIMKJ/9N+70E2y7j3lTvHAtCLPGaJWGQ9k/WT06Bl7eko1GL4PegahRpr03CfbopL2K1vk4Q5BolK6hHFwmpjOJySxhzEvmIO8aHVJXR7Tsu8vfmF92st3Cdqai4aflcs33aG6LWfztkUaNWgbomG62ngXVaYZdkNUPogqWT9af8wXXoFZt1XO7CLBIHk9JBiENmBu9gUWG0LgVdaPstHh89OCxBLUmRNYNi+5CV9wSVMw/KPCl7d8mC6UtHy3/qLCWdlm850Ye86Gxi/SZhI0TjBlyhtI0s2ufTxQSUL2r44ooR9tuej8F1udF9vHGaRPQ4JBqO3GLKlqbJAKfmbwvm1MwGeUQxYddnNwmxdFpvIohBeUT97C0BhUZXmzVnjvyIpta9Lt9leWl0v/vfaxOQEzcpdiWmfyDriBDZKUMzwPmQdzD6MmEz0BB4HC/ig+yAOGAlNQ/9UkZt374sjZS6fduCBp2ju4ODtEpREqhkxwFy0SG/5w821hY88PRcvFZBlMq3BdJZWETZpRT36gA1nDiPCIQyD2kL5BE/U4dcSNK9ryiJJ778hlm99jH9OAZTW2DBpfVTfXz9fejo1Oj8P5CpCoaNM3alqPKbyiumpqikP81BofFwYTcIGzE5Gd9EZMCtyfc90vXiN9Lg2QBlWUrrA2qCqZWpnaq6aO0OrWLdB09yJMMoCYTMx7kPmW5PR05wVSc+zdvUMMgkVbAp1RCLYgsym2OnXikrK8Rc2/rzfMUVlepox89x+XaqZ+q2JHjyZzMZ2A5cKXvze7QhKDeH9eB0EMjJ1awLD+v+pC+KG8V7b9baieEzLkGITIuXpO/oz8Fv23IhebSAp7b2eVKY++BmIIT3FGz42e3uFkMy4FlyUCufcXvLTR8xdLI/Nd2KnF72y/LGDFvitb+iSbGR5gqsau9I5IG1OkNxrSyMH0d+8HfEJuibwDnWNFkz/ngZEvbXuTDXFpwDQYowwZHSS18YbLM1+PC+oCWxBi1EO0iRepkQ7UPdQDCC8Q74k51ERczlock7Pu7S1z5NibrtCslttly5xE2bExgPKGU2E7BaenerAuMimKkXlZssEcr7Wo2r0jXx7azEGoG5IMwldU2I3+vOcTgu/PzM2brD1MZifaalXcGcV5hNMTjXX93WM/Rr3eD8pBWXAOswW1XueDCxvV4fcXvrJ1Leu6u86o7cvmsi9mBYwt10lW4lbZtickBwpyfxHouDcUSYr5foHVK9ncVC/8YbRgNUQa8suC6GfpkvZqQs29d/jSmnfThWm/sgbRC2rBIRvqZw87TYtHn1At/YikjxUdekPSRnJjuc6Rkx7aiPjoXHUSeXhsF8IIF5NtJq9sASH+ISrlPTV8+YatnZex/9vK66fnjqiuuT5sVv+X6OAAT+TpORxC50B00h0Idm8itD2MyTkWBgM+eaMmrugYyMXGEgXTFLRlzb7snwxfujXDHK3oJ+10yIYvXf7d6pzdH8C91ZwK1TbAiItIB6IK7ddLW5KypSBEa738owHJMyFTQkoOvypBMg1Ve8eQtJ9XZU/8w7jF71ezj2n8bCwbXzC8pfpGvx79lmjrJQwgYgboNJ77CGCmfPb9dJIrsQWJeGSQoNHES+OIfEJXQy/vFXIfKl6+BUtnPUx0ksGQe+W13pCr9r4Kb7h8an5pw6YbeBtnADrmWEg/KvWvTOLCT+uEAhIQqlj3vC9xD3fUu5NDICxXOMBT2qlLwb9EtOxFu8757sppN96Y9nzC7tnDCsN67L9wbsmNqmEV2kTcmNsQsUQW1iYwCMHVU0AcVAHLjUH+FN9TXABXTBf9zzUECn9Rsnj9RxnmaI/HIc8ghI6tOD0pJ779XOw7ezJEq6PgwOj3jELw5ewzhkCEggAZCM6vsrPVdKS3atWSv09Y8tGW3hDhhouOKBph7rgpYDvX44iFfLK6Mc0B5mJyvGdqZFIRad+2HZ48pndxOid2aWcypCH6ovD3+qMRLn1kWMUaOB9mQkcM9Ln5O2Z0+D+7fHXZCfl2omGc6ET83tAhob9tDe2mSFof2j4mI+2La4kS+nkF+3A5lhHWtr8z575t83o50bZr7pGjgrHqb/mt6Fdxhkk28ztk0g/pHBAKWet5OlN7CPCBBgkyKROH0z3Nv2A0Y7tLwqdfV+SWqBx+wggW/WzE8x9UIUYmdIKBDIN0gpTPw6uqsmPG5DTv+XbArrsaIlGYx/wG7RtBRzZQ8NZn0L2nV7CXyR9wDjEPOUEm3dspnqeoi9CF+EiLL/BYQ2jkz8c//9FnvRnRkkUMlWuGQT6HLb1z9piJYaPxJp+hXwv9OQC/Q6ZvpDtDDhsDC56xgUYNsACNINA7LFFp1qXQEw1ZuT8pfX7Drs9h9T9XIGUY5HPVHHBX/+LYKSGp/hbVjn4FTodB0DXr4D0TrmeD6glkNqdBQpglwcRMri00ksCUK8kNMdX/O3v4Eb/Me/wdjByZ0BMGMgzSE4YO4vc95xccnwXXEck154I5sLkCGIL2pCJdAqMIOyOdcUxPQJG7CBR4pOFpaS1M1vBirsWx1AsaCof/aszCyrTPMumppMH+fUjPg3yeGrd61tgTw3rT91Q3MQc8AFOzZ751aRaPCJ3MsmTd7QpoT45i4hSLQsnwRyZgQ/LviEqh39QFi/933LMfDomVgF2hqbfvu7LD9DafTPw+Y8Dlqy6ZcEo40gDmMM4HPUuMCWhrFfAECVUeU9Av44L2JeEVs2ZBeSc3FrqnyU3S5QWMPIaoVjUp2b9MhHOfnPDs+w3tE2eeesJAZgTpCUMH8jv8PPb8e+wZWXrzD1Q3cj52XMEqQNpUgqYnScBKjhjEGBQ8VvHuk78YW2iUIRcZaOe0pQ+JVPTKlP2bEkr2o/VjSp4c+/s1g/YMjyQmDsS1M4wfiHIyeXbAAJ1TeG7i71/wxYwfYM/bma5swE0KhE1HPEHG8mbw02semxiCjSSwUoEzZORhSsKGuJrz6E7fxGcmV6yKdCg+85gmBjIiVpqIGshojDmib56l2Yk7RFc/g7EBFlCREo6tfpibFDxJOh8wOgKC+Gyuw8HJWZLJiWAWS5A/jcnaQ9uzp7xw7CA9t6MjGg7UM/kqZMJBxACtH59hvH6eZjZicwXzDFY00xlINCLFAYoHm8jYv2lI7EpOFJLQ5f2BvXDDY32JQMzBaetaRO2BT7Txz2WYo/8Nm94Y3v9yMjkAA6sfmy+P+svS8wOx+Pf8ZuwUch0hniBtHPq1p2EwJzBSDZMsQN+9QAo4czIBD5EYRroHzahTXBLJdCXwfpOU/9P37IkvXrBihd6aLHPpBwYyDNIP5PUm6cabblJztz8/S9Njt/kMexoOOSPrLSieVHIKjFPYXZc/SEA6Bn4ZYzFmQTJIV5wuK/+OKQU/rio875VpC4bWziNd4msAPmQYZACQ2FMWK6+d4Tu27pO5ASvyXcU0sPMIuX1AXMLiKdIf2NyfN5R0m5V3BAGNFkiP4wTJfYSCJfveqvWFHxh5/Pw/DZUN3bpF1AB+zDDIACKzs6zWXn1MoLR++1c0M/EdxeaO5rCjOq1JZ/MV+El1Juwsfbt3YAhaAQhFBSIWmXRpK1D5nzE59/7cV7a/NlR3HmmHowF+yDDIACM0Nbv1X50dKqp+9z9ku+Gbqu1MdLHAieQpjzlwi0e2qAqJkg1Bglby3sur4xuaDCTPXMFMiNqquKo+kL+8ZqWXW2rpmfuBwED7thiIHDN5MAw0XliaI3CR632GcZNsx0up1ydvWk+SSkF7UrTypCU2OCBaWyBmYLHZBCBZsSTbcqUaR5FebZAK/zhy+YY3M8zRhq4Bv8nMgww4SmGtmj9LS+x876qAY3wdU3f5FifFWb/PiziBAeOHZ7yiyW4wDclK9IYA8T6QBOXQMAOTL1uSiK3tsJ1PI3T0LRYvrTU5/+q4mvuXkUvWV3UcbyiXTBg4DGQYZOBw2ZbTnugeqQgHARqu8KyuKHQsqKjoMMqS/yGWdgjY4gTb58IDEdsXOtiBHVQO3gFbkG5B84TwwcXWi8RUdGKDwUsx7Ky+DceXr4tnZ3345twTds2bV0FTiZlwgDHA+q0DXMaQy55mykfqH2pm8Qg33hQXJhoWn2vW8ZF4vZClhfhowhaCPpeP2WAAi5gAw4UKrsCwwe4VH69DGvPLMd6X4LgmVY2vKT6h6YJfZuY2hhwxZSqcwUAGAxkMZDCQwUAGAxkMZDCQwUAGAxkMZDCQwUAGAxkMZDCQwUAGAxkMZDCQwUAGAxkMZDCQwUAGAxkMZDCQwUAGAxkMZDCQwUAGAxkMZDCQwUAGA4MbA4eJNy+8XWlhXTIwqJMrjZIv+3qlhRcHI3QF78Eov6uye1vvzmAdqLx7C8vBic9vvPTocbmNn50p2DhLD1vl07F31YG8Fce+vPlzscnxjrJji7TmnTdLrrFvm1SsqGhQ8haNXrr5rf6gactVx5yRE206UXZt2xRtLEvaV0R/8vXS0um2tI0oNlUw/Zw+fNLLIxcs357Md9esqZro7L4qINsaFnaA/QeybOxyIuqcaqrYSE4S6oLhHaOeWbsYi01Su5kkKGldP7nsuNGFjdu+gY3tJJ+JYxWwDxcnylxzMOe5kopPcSpu/8KW2WPOyU/ESkz4/KfmBHqkk9/3C501lSmYnGqLtl8M7m1Q/PVNkrhhckVl/X6JO3lRff74AtnE9q9SFOfmKdhIQxJjqu99KSBYx2Xxxl0MLlqd44huwpYqkcfngkH8id3nZHGRr/K21XqUOVYUYT8pi5OL3rq57P1TH62Id1LftF75m2vODustX+Mcm/NhYd8+8kl3UGnXlu3KpF1LiOhpI2nX9XGN5ggckMm1MUjU1xQobmj+b8XQs9slbHvoCQavbPpNxmyDBh19QMKCErakSuBCZnwNwFncFrGtjHRvXD6/qeirYTdyPY5gx7oVsD0dy8CDUXQTC4RdOhk3ZaFwuvkm47m8ZmR9NeAa04Gs/YUFVrHUWuKevUvWntLQd9SZ9rKwYrpsiGYux3/adF7BP2sKp7w48Y9/35ksrbOrYbuleU7sbsGKoslMDv0KJyQiv5acYK7m1FeNkvESVIet8hUra9gIrDTc0Fk+B/Xdtium5Kh7t1yLM8FzCPsiFt+xTQ4w0gWslnNLdq+bgtd97r1wPrqGAy1Huia276Q136mLwbuoKZY0offEUljso0uH2lBLpcp/3oYK2LuK2g47mBCT2EKcs2J7Q6lZhnwaGN4uQPkFbMVtWuSF8ogO6NBOdsU90QoYgmAgAYjOY2f1AHNQLy+gfNWIb2PxUwHoxf3G687MD+xsnidabg5t+sijQ2HHY5sW53PcL+8sm7SgqKJ/BKM4XK7g2qOw1hiQAXgaN5I4oY2H2+7xmaLsF7xWoCWYDo/u06Klm+4ElddPLqn56Au7Lil9ZOTL27pcv++ICVmwrCIscZY5G+1G+4/ZbliwVYUOIPIKZb2d4yaMGkL/IQ9qy57TNNs+iSPGYCQAMAkyjK+Ka4WD9TVXlmH1Xl8Bxa6EyBg5Q7xiLUB59/BHRygTc9Bww+OIAp62CmV/lJC9ZrikNnRo10MALIKhzeZEkEVI/gTwyZGRiI5lpoTp/FFD4c8rCuV6lNIGAx6pMYlx2S/tKIe4gmP3a2l17t6tF6u2OY7olpiRmIT+6MRdlbOKVb15brJafb0iXxpqATvqRyMUMTqt2m+tI+uLqD+igNdtz/SOnqk96Aa0QRKGg7yQlYozhotUu/H8rEjk4c2XTzwNMbsMAAHFI0NqEHRCtEIaiKNaUwkYLnEakWSbnLknLbGty4IG4sOr2Ikw+OmTVwmc7SfY0LtQSzMk0BEBNNr53eilP9PfXVjBce/3pcyoEoj5ObPesXAKIFDA0NBTRohEu6njqAJORCPSynHRATYxHoiuky841Gu3BhqVALPJS3sdyb8t+ZqujpPr6PLuvZKjg0mJx1nzsihE9tQidG0Xkh/wkliFAm09ChqCamCHRE7322BaioYl7V6F0KNaovwZi9yHn8r/mhyUN1V9DSwnUb44tpflApUVAaxo26Jfby7bfcPZTxQ+/rfd7GOffpAhETmRIzEGb0ex5xekA8diZIo8vZI7yRyL+JFMBTgF6O2KVT4RpJO1oC605uf4fE7ztIJG4+4d10y/puSPb3crbnkloDQgGQyCxqGag3m8gdrh/JZFbw5pmLpz8TTZdr/kOtRjAjaiCCJMQAYhE7DikGXeHRa0mtB7uR+wSL2EuE7TnvM73L9cFAQq6lVqW9Ih8lHHjEaQXFFNNF8v8cYlXjN66KMdEC1BTMSkwMN+HwcY94UPVH/LMf7gN1zbVLyycahUjyF1u10qGw1Ig6sj5vus+h+LllhCO8QTbzAGwW7vCSmwwfTlPtIX/FD+4R2RM/yOfawL0ceWYchAO5AxQyCRHORDfb7Pto5q2rlhNl78jtL0ObC2BRWC6eOStKdeC9xSEGtKsDNPkKnOtnrxcldaC1GwT4yB9zFLFh2f4JdkpVTnhFN9hnmOwptT6Pg6oh1QkBgwzdNaItuuRNKHWpO3u9CgwwislRWpD6CumbchMGObDWRE1VW5uD+MT4dyFHH5QDR8icxZWV5j0+gho7GlTaLlFOEMPz+gJibhRcsu23TZSQvGP8/toOr1JkyZeMWn7+1avrk3aTqLW1IbnaU5jVAw0XsnxR40ii1LXLNP+229lfPEhIrKdmd00AYMK8tn/DO0K7vLjrGzsjq+yzr6P4QRf7r3QeCkwNua1IIICPIBYcRkub5Fzbq7TvL3SU/bNX+qFtj26X+CFdE7E+GidBdGHNn3qeK44wUHdk/YfFCUGuCav7K1/NqnxpQvxDYTvQ8MCegAvStwx9vmRnnypuLX6GwTI+0Mt84Y/ZEYNt/meW2xZUYf0ez4ySRu8I6M/tVQg4nY7F3l8381snxBLJ1MJZLZqNej3g7cQSehclJhEd5VpZP+gMTZfOmRE8Q6u4yUQbZ3LbBmc5Ie1fLvkRNN/xM2zRNoZ3SSuvycMy43XjMLgPy6t8C07mOLivc9NF1UfJJqRO6SYcils8xhBGSZ8TDxRsXg0obA8EcmPP9xbWclzCxfRVp8P4LLV8/K/7rfjl8FIvXZxJw0ygJbligm4krWw4IcXg5TZ/oUlgKNvGPniUHLOIuUVjJOgBvQs6uN8XDunXzznodVN16CE+OYKOK34qf61v3zLCR/NSWLXtwCbg91SIMbKkvBdmK9DGNWVRGD7sLOMrvPtlbfobTseUbirAJS3EnVVCzrmN2fvn8E4rQb0akYZnhgMDA2xRvoIUjjcS39EjjomWWrz5ZTZND/kB2NXoQuq5iJV4QsyPKG6P/wXyOmvOK48rMuejHSQxhTc7akJKKXrZ5fltX/knuXw/pZo8bI8diPFSd6NAnBrGHR02JcQ++trW4O5d8x/vmPez2ypQeFy9fMGnVhVkK/XXCMPFLKSfSkE6pciXdiUvgJ0+QfH9Zh5Eovb9Rk0SLav+ty6IBBNnRA7HHB9Losv/KJOWWFxcsrMcnS2gbYGs/lgr6WhkvLy8ky0ceAIYr+EWHyMCb1J8yrqLDrE5P+aXPie6TsC6yBsLuSbQUVt3Fcd3l71kkvhqAkdRBiGghrkmVy8bo0dJjuSujHt63XTh6umvVX8jY2WgNMtIO5I0hORJEeu+g3f2poEOUXsfXmZ8TIpC9CeeDQg04dX7P63H4U2+uklWXTc0cae8tVLnI69raCJEwTrWgI0SKlfGtcCt9ePPkymk86IGHXnFEnhPS6+3y2XkKmUVJFJCAElgIIJNqSOiH/oRErajodudIBaOfCW6f4jfglzMSJulFbQJ+K64HshacvW9YSdZUFaIe9ZC9joya0dr+hf+m6D0Ydn07+ncZhVhIiRI9NOo3Ti5cTcEaKJQk17HwIKBgurIlkYpEMvr1FsZs8YYIhWd4LxLuQK7FRJilghyZkV9eei3nno12yQjDIeM50pW17VR8buse8Wr2jWZGWMsMPvoM4IYZhPiPRdOnqxx7rX7eTZpXprI/S5i23aLx+CaxrCsFpg5HBJTiPXGuKKKEf5vlDrx+oowigG5SGE40P+iwd80A0YUd9G1oPPWVc9L8dU/LKx776ybY0q9NJNJcPmY2zfW68gGcbP0IMh6yR4IS3Ba6E6TPDpPBqXZL/DxYKtBOdcWJj/tksyLKNy0HgfR9FOoGmX68ER/PETtAKjI02lETdcOvSzdMTsUh9h8znnZDKcTL+HYqw9upzAz47ejmAUlirQ6Z2eNmNq3lPLTpmGzMhghacFr/6ewzx6L3QYwN0IlCFT5xVtOLR0w443DDY52188VrNbJkP5gyxvhu9NinngMmM+7N/tE4av5zvo9zfE/wby8YXZG/d9KBmGaejSPwn7gASYM6CtWxTNDDsB38NbFnXUz7dfd962fRRmC27EgSFnMEcNFpD8HaU4IJhrQeC8is26XEt61lDUHQqnuYvIPLyPj0ye8vcsSXd5X+wvm288phiwTK9EQ1oIprSRbku4VPWpwsDOJ0Jzyy+58tx6Jh/ZP2aGbJrnO5aIH0a1oF2U5KqEnLuk+XlaIHWMHpYaWWUU1+nnoGGd5p5kG07JxjdfRnDQjLigF8h9188dlbAbryN5xIF5I5Ek1ICmcjRk8aU0IKIyD9x+rI3Wwa8aGT4VlmZv7Bp9/dUOz7LcS1sVuqZXXEuCJcQAnXN2vDvN8b5t+ZVpDRqHwAJRredp7jGOJpHcKkLlTB6iP71sdCRf0vNbnOi+J9Qo1+nkROYACm5aIfEGC0RuaLP7UCEPACBzoLMr/vsFkxwjnbJo4FAxAhrccpa3G3vugjW5bV9hpHOC9QDMnsxAMRUYVuEg3VDyp1kGJeKvOMphSQ6wBkuIvlWPHbcB+0qxC94z4z7wr81eaEFYIM90JXaDo0iF2678pQjDxTMNRePOSmcqL1bcowxVIYt0lwE8a0I0Sa0LBooeKj45Z1pD9+UR7qhHDbcidFV8wOu/h8oOUBSDM1qk6JscrIe9QfvcQuO+NME9Ozp5tlZvMrrp+cit/8QXZvNCTIdw4WrKC89vmDijHa2/1NWvNOcUH2L4NgBSNCdARxAJQUte87m2+bRXEHaAbRLJNwaUm6Tr9K9go7IwfXYt35eHrBi12ByHOIQTZCD2SEH2pK0uCurXsdSqWXRN7CErcWjhgiHQsC68YOSaX7bOJ/Kpxl/0o1017fHCI3A6FHXNnrQdwq12TlvhvSWDzDHd4YIczARKvzzRmbX77wUCCmnXCjeQIWNc44elxXbeq9im1ME8sMCZ5JLFCErzqtvcUr290dWVLZj5IEqm/L55qz8i4Nm9DuCbeVasJLRhCAJWA5Z+OTAz3crOU9PXrA81t8y86s3zAza5vEum4AiKzROseLU6oa84iXl5eX7tUO9FHglLETXwop1nIORjBwZVSFyTKjyTXI/ebJ38KTfZJtnjT0x22qBDsZFoXwbKFfmHSc/+GbWONN1Jvtsdyr8svKYCEodKOoR57W3G7O5l7qGaf/yBSgtZKCgAZIFL8PWh4N2cXlV1+eqvJVHuhCjbRABzvt+o8E+8sPOwDj2qQ+jCV79I2z/TEakxhFgTRLcljkby07I7yxNX99tvOnkcH5i592Ko58JZVhkbhbojiSIOAle2xLTcu786fKrPulr/j2lq7605EQNcy2KYxVTExIR0kw2IOCicvDlan/OL9N16+6urMryciVg2vNE1/SRMEJuLOSxm1DCL27bdfHOztIe+dK2GleSXyYCoiUT1LlJruUL6ZGv7ri5zN9ZmoF4B/kypJmxO7OtxvtzErGHso3I/WG75Xuinfiqz9XP4nk9n7xDyOgkYHgyeLFG9+U8OPa5PUyX7QgDDQpJHkj9JkCk8Wxq1GvjP3VMBztAqSv1WbG5mNygLohBavL+WItfe2pyRUWXk1ymkrUESuJqVjMwCPm7aW5iYsBshMvHwAR3kSvmba66PWjGLoa+AX8QpnhgakbkTFGpi6rh8gZdeaOc2793HQgI4NE8NtzYcK9qOUczcy6Iltn00ehRKfBubTDrrgkvbfpsIMoKffj7U2TOPIdEN8aIoAWTV5pj/uyFM1eV03CyX0AUt07wvxQR1c94EtMRg9LLbuIEees7p+6XIM0XPZFhfYP2viVq/4IIOBbi9XiMrONwLUb7ZAs41pQYlfX8mLsxJH9NTM29a4eur+yueErS8XurDkLvW78B8WZeYcd4B/DZ5XPiDddgAmcM+SQxbkXNEqLv3Ur5qG4rNHL5p3tblMCLbP6BXLDRMIJlq8F48+XuIwPQe6GlqxcWfi1otHwNvWqQTJkQsSGU4s6VEzEt+2GXDy7pr9zfFXI3XH5EfnbDtrt8jv4FVE4kVxKyK5G8rwva1oiW9b2xk68ZmLkW1DUn3vIVLHvIIeLyrFcwW7u+lWtjo7q1ipUUFW8AsS5BV03cAdsBUvOO5os1/SeNSl3VL/U9m8pJfdHD/TFvfNTQHMr7hc77atDoiA03HyZVAwYa4vEfk1JkXHgnJiq3NmjKC8e+tjvaQ7atn6l78AIz81Ju5NtEvTfm0Tk59+AxyCfXnJzrN4wygYfnH8oHiUO+Fx3d73/hnIq/NiUB7erqyBomDsWNNNsO+sEQiAkrO3riltffZvpMV+l6fu/ytRcMvyjXitwmO0Y+iXAwmUE3ojNqYXr2Zf1+r+B/omDZhgNisaK5loK6um8H7cQcEJyPCIA6MfRfnCEITREpeGedFHxjoOZaNl4x4SjZ1OfQXAGKQTlwTuSUpiZf+JcXYMKtO3yR0aSF91WYLt9C/uEgJoCL0dwxzvaveW5Sd2n3+8ZoE+nTCLGo9V5cCj5OUVm3QcyJ9DRHlhCV1RE5+KMIF/iGGRBeHlexpVta8sxSRECpZWO09uBIeQlCMKUDJjp6xbX9oteq3zRX5nACLCrHlnFimDZsudLxZb3cFq2bm9flqh0uF1hCDEL+NjTzC8e9QE6i5UYism6Sdvup9sulU8NW472yaY6mlQFkBCB/JDKp6nLW8k1K6cPjD9iyZOCl6oXrs9zY9YLphFE0Wh3yPToxi1ejzUrWj/Yq4aVdWWO6rVinH10+uzkyF2tsiugkXmbahWgSE+S3XX/hW50m6fCywcp5D86kf2YdHDoRGu0k183O0xuvIzG1Q/QuHokOU2ixi1jJ1zRyG0poITx/15LIy3DEVh7AJUYMfLqdH/6r/Neq1wyrqG3nKJpM3/GKkluHjpQRpC0S9ZAHObx18zxf2DSuhsyoYA0wUINKAgxd1l4ufO7jPemAQzb/PVJ2RYIXa7GGDIMQqAmdbdB0pmu1r05NJ4+OceqvGVkajDQ9oLj20UwaB75okRQtTIKP0+pIIK/8+CX/quqYbmCeXb7ugry5wUTLd7G2BB66RLCklEPRVAQ7ouU9Vi9mPzlpAEeuqqumDdfMeBnWlGCAwj+UZfGCHlODT5VUvB1Pp17HvvZhNKKEX4BqD+xjGCFpwIHTjRv98tYlJ0A36CnsI8qeYqZ+/4d8fFWUDz1gQSsnCrZh9qZBULXiM3PCfPE+ok9Nlf69AC2/b5ClX0aXMcdsWjVDsa0TQAOsxyHTZUKQqqJB7TkkShsunRc+NEX1FWIuGt1pNIEsHZQj9TeuLF9Jg37aYfP8qVm+3U33KXb8DDAaOA5goLGJd+HjtCWh5v5wlTC5U8ta2oV0E3HXrKLTYAG6C16nGLksJtUJZEdBw0eV4OK9Us6jE6F7dZNFLz9haUHDjit9MG54egeSA3+moKzZMmzUn3uT2d5Q/t91Tn6T9bXUemhYhTeKshp2fqW1ZXqTXVpxySmxMS/71ajo+xMTfzHK0uYjqmOM8DXs/O5qtGdaGRG4qHnHuK0iFr6kTY4ds+jbs1u2SMxKRG5A4wfIkOZIULTIQMBpf9lQN3pTb3KloTYq+180BV5nq9FYXeAVBee5sR99qzTdvCrLy5T8z3bcDIPBHIg1bC0yU/yRAWb0m5vV8I+bc4r/QY2Sbp69ibf5mrGloXj8Png3TXaoB4aYQqZW/HAxNfRuQisqn/DShwNisUrCtbJsZgC7eZSho8T6M48+SKSMyIGlp/7+7XYTg8k0XV2PefajBkNUn6f1RTSKkF4gwelUsaPX7Zo/M6+rdO3e70ei7b52+jDhmU3N0Dce1gVfg8RWEdIo4nBhLnr+6B1VF3eaKM2XEBoo4JfNerHuN82k/YtWb3xnouxaX2B8C3zSRI4pyE31vtwXZq5aBW7pXdiWFXwDE3araJMCxu3I02+bBVq87mqunKis+0Az+fnv/vW6oNn8daxDCZFoxQgGKDEEyYoIgR+JAaVizMJVtN5gwMPGm84P59fU36+50em0mJ1IjGzuNHjFZQUWq5zvjXj+o7R9iNIFcFJ8y5eCjj2FdnaxiRrQSemSsjEaCL+Qbh6p8Zq00ArdVTax9fpoUybuuNYRdt1OtHW6gdU+3cgs3of2MWsiUuCPBH+yU8PiupDfMr6x8cqT0xDxOi/OIxyCh8ZF/PdMZZ1HHqi3mJEVBKN+PuyWuTR60JYC5NYO0+7fmxLj+rT67RT0Io4cegE0hUlgiCaoDNnm/Fbz5VurThrWE+zfWDvugjwzcTu2fBnmkEWPdRqQaYGXmD/wm1qp4IncHiwhPZXR1ffH4IVcsGn194N2FHMtjkKz42xEx/S0LksNMX/WnS0RHqLLwI7z3sRg7Frsu4IVmuANstKBNU019Oqt9j07uoK3u/ejYTSxeN8zpDDTWjzSCbFSV9aidf9JzqjdpWWdZZtkDYB6EcjS1hgI/yrBy1t4uFQwcRG0hUnD47IatlxLlN2L7NqikuWaMQcNhwQghJ22jwfq5vrKx0f4LPtiwIxCURUUaWLxrClnPX/sa6+laaveH7pGf96KhMCtFchoAnsjKbh+xxwXqK26cP/Y+95Uzyo50afvvg+kMRq7KYBGaD4GecBDFhs7LGsIDfvpwMr9+8qmhitb/uD1QaflBsyuYJ0CthRCh4UlYYBf0uNq8JG9jrn0QMy1ZH/81DTVaTmddo2hCWLqpODXtadJy3u6omJen8RIHkYTXfIvgdGkDnMhqCi6KTg7wE3mtJLIx8en1jz1nma7O4bcji96eB43+eotEUn9GeaK4FNBljQagR0lZEWv33bF+BO6S96VexVUAObwj7REq7AjoXEkIdYn5HQHwL5vLu9LNF1OKwaJOagitKbA4v1v1fiG/3VfvN7fja6o3K2L/ueJOYAaZEA+OK4UMBM3bL12TqcbtK0vmzgm26j7kWaYR2OtExAKmEiORcqIHHq7MZj/vbHP9mdtRXf1wFzL7OILAvqu27E7SB65kFCfQfoHNvaz4mL2YwlbfGzSsr0DP9cCkVKNNsxXHBtOhSSWAE70lnHJ/1e9KfFRd1D39K0yNmF9QtbQDp6fn4NRCRZBv2uZNyxKc+KQ2q63geaEGqRhzyUE/zvEbzQgehYtozTY2PCN3hpsaPSAcJPqrIh+08Zy+R07J225pMjAskfG1iAadu0twJYgCZHwsJrjUrZZqbz+1BztM+tKrKUgLY41ig1IImrgxckVvVMKO8IDIN3N4byX/Wb1N3yOWYKluXgDX1OHP97X8D65PbyamuaTa07KK97zyV2wpGHrVeobaC6GtCEAxjvRhBxcDEulUjV71PGSgHVR6F8tB8MKQluPQzcdnJ9TvaHpMzZP4OxxR22a9NCydoS+7cJRJ2h6032wuI3CZgAMVhq4qHFNXv24SVX+Loti0c7Z44spT68oTOS2FU6QUPAAMJNwpMIE0aAhlNNy/LMfbPTier97Nk0di0nIczFisr3myFJm8RLmWHKembC0fx7B0CETuy4sfTJoRK+RBAP6HAKGKDWhXzhp4/MT8dQvBvRq0PkvjfR7Liq+X000PIvtJbLIcI3GFIJmfM5RH1yzDA9LOk+Z8pYB7D1LIvbBIg7HHBsCelzXkbJbdv4wy7UjkOOJWqhjQcAeUPTQLnTG5RQHYgLFg6dXi2g/gbtf0COF8J4dX1Js5yhibdJ3aOLNFKRPWnJylmKtvRepH79jd5duaZarK3y8ewvTQ9DwMm+pPr3pRizkXwkLVJtdP7d515f9TmIuVBaVuftDJPMUcxqeXTUcr70u4IpXUgdLIBEePKHBA5DuubbcvHf0m4zn4QG+QLrgNlbnfx2f3knGqiybHMxv2lkOD+YprPcmcQQ3zGoFOOAkUZqvW3dizRJrg9Ry25fZSRu0wkTWKOr+fLy5Gm37NVYAAUCyx+zh12ENTSHrpCgLAG3wvtejeSNe57gtSTD7fP1g7OSPT9/Q9LcQWQSZAYiDPmDmD4/UXYryP0bDtwOctAYK9Es0QRjvlQmNpfZ+3jdy/zFdjC8NucY15KxIlVNcPUdLRG+qvP68f07+/V/2yxrbJ3Mu+QsgOlPFWCtiBPHVVUOJAncAMvpAXpxQqo5g8huVx0iDrlQQAquBd9vu2asf4lECSGgk1KJPlnSnCInwwLu0YXPI2HyDhGWqtNgH+yAzpouo8hNjx1YOiPmShwWsblZhhRGLfA37VIWoaAJFM52ZM7mPjgJw7yWhV11uAhY7hcg0zPyPGOz0FYwC3GBkOQouOMggmaL1io8sJOvc+th2SX4nZGEEI1wqth5q+44by5fQhEZzKmRkUjda8Us3XqboqHKwP0BuW1b7PnnZpJbdFsn7hAIZytnMPzq/gBFvaP3CLhuumJanGYmvQI1m1gC2l5YkuHDPqJj0xMAs9qJtjeouHPFb0zHOg+MiyA9k6ia4QFS+attVZz47iuPa+XfREmuvg0BlqPNEFXqrgyTreB4mLXfPHvNT1YqejRnoInIOIouB5sanj6z+4CrEa+uwk2lSpYBkJ0nNjm3NouAVEDQRBywPJIOTPw6kYRAJ3bf+gROxkQK+t/4l76GAsb1a6Yp8vHvqu+kZ86q8sa8ppdoTfJZxIsFL2gEhxOTlPfV5Y17hy/cjwzbYe3uzlSvGxKG8jOpAxEfrxWUuHhLiDVcvSnF7wAIt0oSRvQci9WnJP/YKlM3qC3wQTtr+kjhIfZd6n/xOV8IfCmEDdEpFCgPUeWN0oNBWrqcLEAxIgol7pGd5pFyTDSSHngAAAvZJREFU5QBdxLnsj3Cf+scmGKlNvTYh4YmV0/qT01x9sc+Mj6WJSGYnQdvrnH9tc9DfTgRNTdOX+43ZpW8bvLAOO0kAUsaL2CTcLvHX75zVMT8PQFSctQfwgBf7dfMdE3XzvK5567oWJWsh6AtqLuVL1GD5fU70hk3XTx/faVICAgVTmxE1kieWkPD7MA7jC3xZBCjLtHSUtRvJbqSlsCvd40/EM/3R++SVxSHBmYaf5LU1Dr6hHPrgvlU23R+ONX4TqIKlBqRBZaIoU9ZeaFG4zZ0C3MeX05a/F4PY9rguyAatdpGI8cl5To9dMe3psW3IMQU4HAFUnug0tZ7t7pN1SeIj+ZzGFdkTXiSYaFTUNTXELOh6GFjoO99WHmK03SP/VHwzPKeW2domLH7qe7qntqTmRRzUH24qeOmF1fO/mKWa+nxRcGj/cq/uUKtMKbB4dEXV7mS8gbie8sw7zdiu6XdY4AVvGeoVCRZDCNj1V66/bOLI1DIgVGJnNyCJ0RGBi50C+xFmruKshL/wtxgV/0XWSB5ytIieR3X1ScG9W79F2xqlZo+BARACAFY+tRu523CCZIvKp6YlLAQS0TdhaEOnw3yi2pIDyRRQv85D63dqwJSAkZ06bx5bt/6bXg/Xa8LYvrIFG6k/x/MybO42jEWi06JKf5gGb9CUpANymx0qXN3YtOMxlDMMcjj2MlbAj7wUUgUwqBfgAfaOY4h/sNmqK+on0NVQh58akvVKrX/7qtIA0CFRawbAKH2xsfevabdXsLLiTJN4CqvfwuhwmDEPsfeJc8lyU2Gh7Kjsrq7JuBh1KCLaGL6bNm/gnAxkTWByQWtHgOetSiyU24I5HjJj0Fhv8QHxRVScxaF4AxWUUOFSoyE2FZbXoI0OFEtY0Q6mG2zWaW6qVekE7fH5K0yH304kKKLHQDV3Zxs48KMfoRheB3svGvETMxafDWMEmweFeRDdlR5d9uefa8i6zWgCv7fdoP/fmzBIEacAg0Jc01b/PzkA0f9ZptSJAAAAAElFTkSuQmCC";

const SOCIEDAD_EXTRA: Record<string, Partial<SociedadPDF>> = {
  "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021": {
    domicilio: "Pueyrredón 653, Pergamino, Buenos Aires",
    telefono: "2477 628958",
    email: "administracion@lazzari.com.ar",
    commercialEmail: "ventas@lazzari.com.ar | jeronimo@lazzari.com.ar | sebastian@lazzari.com.ar",
    web: "http://www.lazzari.com.ar",
    inicioActividades: "01-09-2017",
    ingresosBrutos: "20379309128",
    jurisdiccion: "Buenos Aires",
  },
  "fee94607-747a-4e87-ba24-aff9032f7a56": {
    domicilio: "Charcas 5151 Piso:1 Dpto:106",
    telefono: "2477 628958",
    email: "administracion@lazzari.com.ar",
    commercialEmail: "ventas@lazzari.com.ar | jeronimo@lazzari.com.ar | sebastian@lazzari.com.ar",
    web: "",
    inicioActividades: "13-05-2026",
    ingresosBrutos: "30719396042",
    jurisdiccion: "Buenos Aires",
  },
};

export function getSociedadPDF(sociedad: {
  id: string;
  nombre: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
  colorPrimario: string;
}): SociedadPDF {
  const extra = SOCIEDAD_EXTRA[sociedad.id] || {};
  return {
    nombre: sociedad.nombre,
    razonSocial: sociedad.razonSocial,
    cuit: sociedad.cuit,
    condicionIva: sociedad.condicionIva || "Responsable Inscripto",
    colorPrimario: sociedad.colorPrimario || "#FF4500",
    domicilio: extra.domicilio || "",
    telefono: extra.telefono || "",
    email: extra.email || "",
    commercialEmail: extra.commercialEmail || extra.email || "",
    web: extra.web || "",
    inicioActividades: extra.inicioActividades || "",
    ingresosBrutos: extra.ingresosBrutos || "",
    jurisdiccion: extra.jurisdiccion || "",
  };
}

// ── Shared base styles ───────────────────────────────────────────
function baseStyles(color: string) {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 12px; line-height: 1.45; background: #fff; }
    .page { max-width: 210mm; margin: 0 auto; padding: 12mm 15mm; }

    /* Header bar */
    .header-bar { background: ${color}; height: 6px; border-radius: 3px 3px 0 0; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 0 14px; border-bottom: 2px solid #e0e0e0; margin-bottom: 18px; }
    .header-left {}
    .company-sub { font-size: 11px; color: #444; margin-top: 3px; font-weight: 600; }
    .company-detail { font-size: 9px; color: #444; margin-top: 1px; }
    .header-right { text-align: right; }
    .doc-title { font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #333; font-weight: 700; }
    .doc-number { font-size: 15px; font-weight: 700; font-family: 'Courier New', Courier, monospace; color: #222; margin: 3px 0; }
    .doc-badge { display: inline-block; padding: 2px 14px; border-radius: 10px; font-size: 9px; font-weight: 700; background: #f0f0f0; color: #333; text-transform: uppercase; letter-spacing: 0.5px; }
    .doc-date { font-size: 10px; color: #333; margin-top: 5px; }

    /* Info boxes */
    .info-grid { display: flex; gap: 16px; margin-bottom: 18px; }
    .info-box { flex: 1; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 14px; }
    .info-box-title { font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; color: ${color}; font-weight: 700; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #f0f0f0; }
    .info-row { margin-bottom: 4px; }
    .info-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; font-weight: 600; }
    .info-value { font-size: 11px; font-weight: 500; color: #333; }
    .info-value-lg { font-size: 13px; font-weight: 700; color: #222; }

    /* Shared compact document structure */
    .doc-header-table { width: 100%; border-bottom: 2px solid #e5e5e5; border-collapse: collapse; }
    .doc-header-wrap { position: relative; }
    .doc-header-table td { border: 0; background: transparent !important; padding: 12px 0 10px; }
    .doc-header-table td:last-child { text-align: right; vertical-align: top; }
    .doc-header-logo { height: 43px; display: block; margin-bottom: 3px; }
    .doc-marker-cell { width: 76px; text-align: center !important; vertical-align: top; }
    .doc-marker { display: inline-flex; min-width: 46px; min-height: 46px; padding: 5px 8px; border: 2px solid ${color}; color: ${color}; align-items: center; justify-content: center; font-size: 28px; line-height: 1; font-weight: 900; }
    .doc-marker-code { margin-top: 3px; color: #333; font-size: 7px; font-weight: 700; text-transform: uppercase; }
    .doc-marker-overlay { position: absolute; left: 50%; top: 12px; z-index: 2; transform: translateX(-50%); text-align: center; }
    .legal-banner { margin: 6px 0 12px; padding: 4px 8px; border: 1px solid #dedede; color: #333; text-align: center; font-size: 8px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; }
    .compact-strip { width: 100%; margin-bottom: 14px; border-top: 1px solid #dedede; border-bottom: 1px solid #dedede; border-collapse: collapse; table-layout: fixed; }
    .compact-strip td { padding: 8px 10px; vertical-align: top; border: 0; background: transparent !important; }
    .compact-strip td + td { border-left: 1px solid #e5e5e5; }
    .compact-title { margin-bottom: 5px; color: ${color}; font-size: 8px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; }
    .compact-primary { margin-bottom: 3px; color: #222; font-size: 12px; font-weight: 700; }
    .compact-line { margin-top: 2px; color: #444; font-size: 9px; line-height: 1.35; }
    .compact-line-aligned { display: grid; grid-template-columns: 76px minmax(0, 1fr); column-gap: 4px; align-items: baseline; }
    .compact-line-aligned .compact-label { margin-right: 0; }
    .compact-label { color: #444; font-size: 7px; font-weight: 800; letter-spacing: .45px; text-transform: uppercase; margin-right: 4px; }

    /* Items table */
    .items-title { font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; color: ${color}; font-weight: 700; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #f0f0f0; }
    table { width: 100%; border-collapse: collapse; }
    td, th { overflow-wrap: break-word; word-break: break-word; }
    thead th { background: #f7f7f7; padding: 8px 10px; text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: 0.8px; color: #333; font-weight: 700; border-bottom: 2px solid #e0e0e0; }
    thead th.right { text-align: right; }
    thead th.center { text-align: center; }
    tbody td { padding: 7px 10px; font-size: 11px; border-bottom: 1px solid #f0f0f0; color: #111; }
    tbody tr:nth-child(even) td { background: #fafafa; }
    tbody tr:last-child td { border-bottom: 2px solid #e0e0e0; }
    .mono { font-family: 'Courier New', Courier, monospace; font-size: 10px; font-weight: 600; }
    .right { text-align: right; }
    .center { text-align: center; }
    .bold { font-weight: 700; }

    /* Presupuestos: mantener identificadores y números completos en una línea. */
    .pr-items { table-layout: fixed; }
    .pr-items th, .pr-items td { padding-left: 6px; padding-right: 6px; }
    .pr-items thead th { padding-top: 6px; padding-bottom: 6px; }
    .pr-items tbody td { padding-top: 5px; padding-bottom: 5px; }
    .pr-items .pr-nowrap { white-space: nowrap; word-break: normal; overflow-wrap: normal; }
    .pr-items .pr-code { font-size: 10.5px; font-weight: 700; }
    .pr-document .footer { margin-top: 12px; padding-top: 5px; }
    .pr-document .footer-legal { margin-top: 4px; }

    /* Totals */
    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 14px; }
    .totals-box { width: 260px; }
    .total-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 11px; color: #222; }
    .total-row .mono { color: #222; }
    .total-row-final { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; margin-top: 4px; border-top: 2px solid #222; font-size: 12px; font-weight: 700; color: #222; }
    .total-row-final .mono { font-size: 12px; }

    /* Observations */
    .obs-block { background: #f9f9f9; border: 1px solid #e8e8e8; border-radius: 6px; padding: 12px 14px; margin-top: 18px; }
    .obs-title { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #444; font-weight: 700; margin-bottom: 5px; }
    .obs-text { font-size: 11px; color: #222; line-height: 1.5; white-space: pre-wrap; }

    /* Footer */
    .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; font-size: 8px; color: #555; }
    .footer-legal { text-align: center; font-size: 7px; color: #666; margin-top: 6px; }

    /* Signatures */
    .signatures { margin-top: 60px; display: flex; justify-content: space-between; }
    .sig-line { width: 180px; border-top: 1px solid #333; text-align: center; padding-top: 6px; font-size: 10px; color: #666; }

    /* Print */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { padding: 8mm 12mm; max-width: none; }
      .header-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tbody tr:nth-child(even) td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
    }
    @page { margin: 8mm; size: A4; }
  `;
}

interface DocumentHeaderOptions {
  title: string;
  number: string;
  date: string;
  secondary?: string;
  badge?: string;
  marker?: string;
  centerMarker?: boolean;
  markerCode?: string;
  legalLegend?: boolean;
  fiscalDetails?: boolean;
  contactEmail?: string;
}

function documentHeader(soc: SociedadPDF, options: DocumentHeaderOptions): string {
  const contactEmail = options.contactEmail || soc.email;
  return `
    <div class="header-bar"></div>
    <div class="doc-header-wrap">
    ${options.marker && options.centerMarker ? `<div class="doc-marker-overlay"><div class="doc-marker"${options.marker.length > 2 ? ` style="font-size:17px"` : ""}>${options.marker}</div>${options.markerCode ? `<div class="doc-marker-code">${options.markerCode}</div>` : ""}</div>` : ""}
    <table class="doc-header-table">
      <tr>
        <td style="vertical-align:top${options.centerMarker ? ";width:50%" : ""}">
          <img src="${LAZZARI_LOGO_B64}" alt="${soc.nombre}" class="doc-header-logo" />
          <div class="company-sub">${soc.razonSocial}</div>
          <div class="company-detail">CUIT ${soc.cuit} | ${soc.condicionIva}</div>
          ${soc.domicilio ? `<div class="company-detail">${soc.domicilio}</div>` : ""}
          ${options.fiscalDetails && soc.ingresosBrutos ? `<div class="company-detail">IIBB ${soc.ingresosBrutos}${soc.inicioActividades ? ` | Inicio de actividades ${soc.inicioActividades}` : ""}</div>` : ""}
          ${contactEmail ? `<div class="company-detail">${contactEmail}</div>` : ""}
        </td>
        ${options.marker && !options.centerMarker ? `<td class="doc-marker-cell"><div class="doc-marker"${options.marker.length > 2 ? ` style="font-size:17px"` : ""}>${options.marker}</div>${options.markerCode ? `<div class="doc-marker-code">${options.markerCode}</div>` : ""}</td>` : ""}
        <td${options.centerMarker ? ` style="width:50%"` : ""}>
          <div class="doc-title">${options.title}</div>
          <div class="doc-number">${options.number}</div>
          ${options.badge ? `<div class="doc-badge">${options.badge}</div>` : ""}
          <div class="doc-date">${options.date}${options.secondary ? ` &mdash; ${options.secondary}` : ""}</div>
        </td>
      </tr>
    </table>
    </div>
    ${options.legalLegend ? `<div class="legal-banner">Documento no válido como factura</div>` : `<div style="height:12px"></div>`}
  `;
}

function documentFooter(soc: SociedadPDF, documentLabel: string): string {
  return `<div class="footer"><span>${soc.razonSocial}</span><span>${documentLabel}</span></div>`;
}

// ── Factura-specific styles (ARCA layout — matches Netegia design) ─
function facturaStyles(color: string) {
  return `
    ${baseStyles(color)}
    /* Header box — three columns: logo | letra | comprobante */
    .fc-header { display: flex; border: 2px solid #222; margin-bottom: 0; position: relative; }
    .fc-left { flex: 1; padding: 14px 16px; display: flex; align-items: center; justify-content: center; }
    .fc-left img { max-height: 80px; }
    .fc-right { flex: 1; padding: 12px 16px; }
    .fc-center { width: 60px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 6px; border-left: 2px solid #222; border-right: 2px solid #222; }
    .fc-letra-box { background: #222; color: #fff; font-size: 32px; font-weight: 900; line-height: 1; padding: 4px 10px; text-align: center; }
    .fc-cod { font-size: 8px; color: #444; text-align: center; margin-top: 4px; font-weight: 600; }

    /* Emisor block — below the header box */
    .emisor-block { border-left: 2px solid #222; border-right: 2px solid #222; border-bottom: 2px solid #222; padding: 12px 16px; margin-bottom: 16px; }
    .emisor-name { font-size: 14px; font-weight: 700; color: #222; margin-bottom: 2px; }
    .emisor-detail { font-size: 9px; color: #444; margin-top: 1px; }

    /* Comprobante right column */
    .comp-tipo { font-size: 13px; font-weight: 700; font-style: italic; text-align: right; color: #222; }
    .comp-sub { font-size: 9px; text-align: right; color: #666; }
    .comp-line { font-size: 10px; text-align: right; color: #444; margin-top: 3px; }
    .comp-line b { color: #222; font-weight: 700; }

    /* Receptor + comprobante data — no bordered boxes */
    .fc-data { display: flex; gap: 24px; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #ccc; }
    .fc-data-left { flex: 1.2; font-size: 10px; color: #333; line-height: 1.6; }
    .fc-data-right { flex: 0.8; font-size: 10px; color: #333; text-align: right; line-height: 1.8; }

    /* CAE section */
    .cae-section { margin-top: 20px; padding: 14px 16px; border: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
    .cae-label { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #444; font-weight: 700; }
    .cae-value { font-size: 11px; font-weight: 700; font-family: 'Courier New', Courier, monospace; margin-top: 2px; color: #222; }
    .cae-vto { font-size: 9px; color: #333; margin-top: 3px; }
    .qr-box { text-align: center; }
    .qr-box img { width: 100px; height: 100px; }
    .qr-text { font-size: 7px; color: #555; margin-top: 2px; }
  `;
}

// ────────────────────────────────────────────────────────────────
// PRESUPUESTO PDF
// ────────────────────────────────────────────────────────────────
interface PRItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precioVenta: number;
  total: number;
  ivaPorcentaje?: number;
}

interface PRData {
  numero: string;
  fecha: string;
  vencimiento: string;
  estado: string;
  estadoLabel: string;
  moneda: "ARS" | "USD";
  subtotal: number;
  iva: number;
  total: number;
  observaciones?: string;
  condicionPago?: string;
  creadoPor?: string;
  clienteNombre: string;
  clienteCuit?: string;
  clienteCondicionIva?: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  clienteDireccion?: string;
  clienteLocalidad?: string;
  clienteProvincia?: string;
  sucursalNombre?: string;
  sucursalDireccion?: string;
  vendedorNombre?: string;
  tipoComprobante?: string;
  modalidadEmision?: string;
  cotizacionModalidad?: "divisas" | "billetes";
  tipoCambio?: number | null;
  items: PRItem[];
}

export function generatePresupuestoPDF(
  pr: PRData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const mon = pr.moneda;
  const isB = pr.tipoComprobante === "B";
  const isManual = pr.modalidadEmision === "manual";
  const manualTotal = pr.items.reduce(
    (sum, it) => sum + Number(it.cantidad) * Number(it.precioVenta),
    0
  );

  type PaginatedItem = { item: PRItem; originalIndex: number };
  const pages: PaginatedItem[][] = [];
  let currentPage: PaginatedItem[] = [];
  let usedRows = 0;
  const pageCapacity = 12;
  pr.items.forEach((item, originalIndex) => {
    const visualRows = Math.max(1, Math.min(3, Math.ceil(String(item.descripcion || "").length / 68)));
    if (currentPage.length > 0 && usedRows + visualRows > pageCapacity) {
      pages.push(currentPage);
      currentPage = [];
      usedRows = 0;
    }
    currentPage.push({ item, originalIndex });
    usedRows += visualRows;
  });
  if (currentPage.length > 0 || pages.length === 0) pages.push(currentPage);

  const clientStrip = `
<table class="compact-strip">
  <tr>
    <td style="width:64%">
      <div class="compact-title">Cliente</div>
      <div class="compact-primary">${textoSeguro(pr.clienteNombre)}</div>
      ${(pr.clienteCuit || pr.clienteCondicionIva) ? `<div class="compact-line">${pr.clienteCuit ? `<span class="compact-label">CUIT</span>${textoSeguro(pr.clienteCuit)}` : ""}${pr.clienteCuit && pr.clienteCondicionIva ? ` &nbsp;|&nbsp; ` : ""}${pr.clienteCondicionIva ? `<span class="compact-label">IVA</span>${textoSeguro(pr.clienteCondicionIva)}` : ""}</div>` : ""}
      ${pr.sucursalNombre ? `<div class="compact-line"><span class="compact-label">Sucursal</span>${textoSeguro(pr.sucursalNombre)}${pr.sucursalDireccion ? ` &mdash; ${textoSeguro(pr.sucursalDireccion)}` : ""}</div>` : ""}
    </td>
    <td style="width:36%">
      <div class="compact-title">Datos comerciales</div>
      ${pr.vendedorNombre ? `<div class="compact-line compact-line-aligned"><span class="compact-label">Vendedor</span><span>${textoSeguro(pr.vendedorNombre)}</span></div>` : ""}
      ${pr.condicionPago ? `<div class="compact-line compact-line-aligned"><span class="compact-label">Pago</span><span>${textoSeguro(pr.condicionPago)}</span></div>` : ""}
      <div class="compact-line compact-line-aligned"><span class="compact-label">Moneda</span><span>${mon === "USD" ? `USD ${pr.cotizacionModalidad === "billetes" ? "billete" : "divisa"}` : "ARS - Pesos argentinos"}</span></div>
      ${mon === "USD" && pr.tipoCambio ? `<div class="compact-line compact-line-aligned"><span class="compact-label">Tipo de cambio</span><span>$ ${Number(pr.tipoCambio).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ""}
    </td>
  </tr>
</table>`;

  const totals = `<table style="width:100%;margin-top:14px;border-collapse:collapse">
  <tr><td></td><td style="width:260px">
    ${isManual ? `
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">TOTAL (${mon})</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(manualTotal, mon)}</td></tr>
      </table>` : isB ? `
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="font-size:11px;color:#333;padding:5px 0">Subtotal (IVA incluido)</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(pr.total, mon)}</td></tr>
        <tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">TOTAL (${mon})</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(pr.total, mon)}</td></tr>
      </table>
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #bbb">
        <div style="font-size:9px;font-weight:700;color:#555;line-height:1.35">Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#444"><span>IVA contenido</span><span style="font-family:'Courier New',monospace;font-weight:700">${formatCurrency(pr.iva, mon)}</span></div>
      </div>` : `
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="font-size:11px;color:#333;padding:5px 0">Subtotal</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(pr.subtotal, mon)}</td></tr>
        <tr><td style="font-size:11px;color:#333;padding:5px 0">IVA</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(pr.iva, mon)}</td></tr>
        <tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">TOTAL (${mon})</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(pr.total, mon)}</td></tr>
      </table>`}
  </td></tr>
</table>`;

  const pageHtml = pages.map((pageItems, pageIndex) => {
    const itemRows = pageItems.map(({ item: it, originalIndex }) => {
      const ivaPct = Number(it.ivaPorcentaje ?? 21);
      const precioUnitarioCliente = isB ? Number(it.precioVenta) * (1 + ivaPct / 100) : Number(it.precioVenta);
      const totalCliente = isB ? (Number(it.total) || Number(it.cantidad) * precioUnitarioCliente) : Number(it.cantidad) * Number(it.precioVenta);
      return `<tr>
        <td class="center pr-nowrap">${originalIndex + 1}</td>
        <td class="mono pr-code pr-nowrap">${textoSeguro(it.codigo)}</td>
        <td>${textoSeguro(it.descripcion)}</td>
        <td class="right pr-nowrap">${it.cantidad}</td>
        <td class="center pr-nowrap">${it.unidad || "u"}</td>
        <td class="right mono pr-nowrap">${formatCurrency(precioUnitarioCliente, mon)}</td>
        <td class="right mono bold pr-nowrap">${formatCurrency(totalCliente, mon)}</td>
      </tr>`;
    }).join("");
    const isLastPage = pageIndex === pages.length - 1;
    const pageNumber = pageIndex + 1;
    const firstItemNumber = pageItems.length ? pageItems[0].originalIndex + 1 : 0;
    const lastItemNumber = pageItems.length ? pageItems[pageItems.length - 1].originalIndex + 1 : 0;
    const dueDate = pr.vencimiento ? `Vence ${formatDate(pr.vencimiento)}` : "";
    return `<div class="page pr-document pr-page${isLastPage ? " pr-page-last" : ""}">
${documentHeader(soc, {
  title: pageIndex === 0 ? "Presupuesto" : "Presupuesto · Continuación",
  number: pr.numero,
  date: formatDate(pr.fecha),
  secondary: [dueDate, `Página ${pageNumber} de ${pages.length}`].filter(Boolean).join(" · "),
  badge: pr.estadoLabel,
  marker: `PR ${pr.tipoComprobante || "X"}`,
  centerMarker: true,
  legalLegend: true,
  contactEmail: soc.commercialEmail,
})}
${clientStrip}
${pageIndex > 0 ? `<div class="pr-continuation-label">Continuación del detalle · ítems ${firstItemNumber} a ${lastItemNumber}</div>` : ""}
<div class="items-title">Detalle de productos / servicios</div>
<table class="pr-items">
  <thead><tr>
    <th class="center pr-nowrap" style="width:34px">#</th>
    <th class="pr-nowrap" style="width:96px">Código</th>
    <th>Descripción</th>
    <th class="right pr-nowrap" style="width:62px">Cant.</th>
    <th class="center pr-nowrap" style="width:42px">Unid.</th>
    <th class="right pr-nowrap" style="width:104px">${isB ? "P. Unit. final" : "P. Unitario"}</th>
    <th class="right pr-nowrap" style="width:112px">${isB ? "Total final" : isManual ? "Total" : "Subtotal"}</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>
${isLastPage ? totals : `<div class="pr-continues">Continúa en la página ${pageNumber + 1} de ${pages.length} →</div>`}
${isLastPage && pr.observaciones ? `<div class="obs-block"><div class="obs-title">Observaciones</div><div class="obs-text">${textoSeguro(pr.observaciones).replace(/\n/g, "<br/>")}</div></div>` : ""}
<div class="pr-page-footer">
${documentFooter(soc, `${pr.numero} · Página ${pageNumber} de ${pages.length}`)}
<div class="footer-legal">${isLastPage ? "Este presupuesto tiene validez hasta la fecha de vencimiento indicada. Los precios pueden estar sujetos a modificaciones." : `Documento continúa en la página ${pageNumber + 1} de ${pages.length}.`}</div>
</div>
</div>`;
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${pr.numero} - ${soc.razonSocial}</title>
<style>${baseStyles(c)}
  .pr-page { min-height:265mm; display:flex; flex-direction:column; }
  .pr-page + .pr-page { page-break-before:always; }
  .pr-page-footer { margin-top:auto; }
  .pr-continuation-label { margin:-4px 0 8px; padding:5px 8px; border-left:3px solid ${c}; background:#fafafa; color:#555; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.7px; }
  .pr-continues { margin-top:12px; padding:7px 10px; border:1px solid ${c}; color:${c}; text-align:right; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.7px; }
  @media print { .pr-page { min-height:265mm; } .pr-page:not(:last-child) { page-break-after:always; } }
</style></head><body>${pageHtml}</body></html>`;
}

// ────────────────────────────────────────────────────────────────
// FACTURA PDF (ARCA layout with letra box)
// ────────────────────────────────────────────────────────────────
interface FacturaItemPDF {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
  subtotal: number;
}

interface FacturaData {
  nota_interna?: string | null;
  observaciones?: string | null;
  tipo: string;
  punto_venta: number;
  numero: number;
  fecha: string;
  fecha_vencimiento?: string | null;
  condicion_venta?: string | null;
  moneda: "ARS" | "USD";
  tipo_cambio?: number | null;
  cotizacion_modalidad?: "divisas" | "billetes" | null;
  subtotal: number;
  iva: number;
  total: number;
  cae?: string | null;
  cae_vencimiento?: string | null;
  oc_cliente?: string | null;
  cliente: {
    razon_social?: string;
    cuit?: string;
    condicion_iva?: string;
    direccion?: string;
    localidad?: string;
    provincia?: string;
    email?: string;
    telefono?: string;
  } | null;
  items: FacturaItemPDF[];
}

interface EmisorData {
  razonSocial: string;
  cuit: string;
  cuitNumero: number;
  condicionIva: string;
  domicilio: string;
  ptoVta: number;
}

export function generateFacturaPDF(
  f: FacturaData,
  emisor: EmisorData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const cli = f.cliente;
  const fce = f.tipo.startsWith("FCE") ? readFceMetadata(f.nota_interna) : null;
  const letraComprobante = f.tipo.slice(-1);
  const isManualX = f.tipo === "X";
  const isB = f.tipo === "FB" || f.tipo === "NCB" || f.tipo === "NDB" || f.tipo === "FCEB" || f.tipo === "NCEB";
  const hideItemIva = isB || isManualX;
  const isUSD = f.moneda === "USD" && f.tipo_cambio;

  const compNum = `${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;

  const tipoLabel = f.tipo === "X" ? "FACTURA (INTERNA)"
    : f.tipo.startsWith("NCE") ? "NOTA DE CRÉDITO ELECTRÓNICA"
    : f.tipo.startsWith("NC") ? "NOTA DE CRÉDITO"
    : f.tipo.startsWith("NDE") ? "NOTA DE DÉBITO ELECTRÓNICA"
    : f.tipo.startsWith("ND") ? "NOTA DE DÉBITO"
    : f.tipo.startsWith("FCE") ? "FACTURA DE CRÉDITO ELECTRÓNICA MiPyME"
    : "FACTURA";

  const codMap: Record<string, number> = { FA: 1, FB: 6, FC: 11, X: 0, NCA: 3, NCB: 8, NDA: 2, NDB: 7, FCEA: 201, FCEB: 206, NCEA: 203, NCEB: 208 };
  const codTipo = String(codMap[f.tipo] || 0).padStart(3, "0");

  // QR for ARCA verification
  const qrData = JSON.stringify({
    ver: 1, fecha: f.fecha, cuit: emisor.cuitNumero, ptoVta: f.punto_venta,
    tipoCmp: codMap[f.tipo] || 1,
    nroCmp: f.numero, importe: Number(f.total), moneda: isUSD ? "DOL" : "PES", ctz: isUSD ? Number(f.tipo_cambio) : 1,
    tipoDocRec: cli?.cuit ? 80 : 99, nroDocRec: cli?.cuit ? Number(cli.cuit.replace(/-/g, "")) : 0,
    tipoCodAut: "E", codAut: Number(f.cae || 0),
  });
  const qrBase64 = btoa(qrData);
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${qrBase64}`;

  const mon = f.moneda as "ARS" | "USD";

  const itemRows = f.items.length > 0 ? f.items.map((it, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.descripcion}</td>
      <td class="right mono">${it.cantidad}</td>
      <td class="right mono">${formatCurrency(Number(it.precio_unitario), mon)}</td>
      ${hideItemIva ? "" : `<td class="right">${it.iva_porcentaje}%</td>`}
      <td class="right mono bold">${formatCurrency(Number(it.subtotal), mon)}</td>
    </tr>`).join("")
  : `<tr><td colspan="${hideItemIva ? 5 : 6}" style="text-align:center;color:#444;padding:20px;font-style:italic">Items detallados no disponibles</td></tr>`;

  const trStyle = "font-size:11px;color:#333;padding:5px 0";
  const tdMonoR = "text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111";
  const trFinal = "font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222";
  const tdFinalR = "text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700";

  const totalsHtml = isManualX
    ? `<table style="width:100%;border-collapse:collapse">
        <tr><td style="${trStyle};color:#777">Comprobante interno sin IVA</td><td></td></tr>
        <tr><td style="${trFinal}">TOTAL (${mon})</td><td style="${trFinal};${tdFinalR}">${formatCurrency(Number(f.total), mon)}</td></tr>
       </table>`
    : isB
    ? `<table style="width:100%;border-collapse:collapse">
        <tr><td style="${trStyle};color:#777">Precios finales con IVA incluido</td><td></td></tr>
        <tr><td style="${trFinal}">TOTAL (${mon})</td><td style="${trFinal};${tdFinalR}">${formatCurrency(Number(f.total), mon)}</td></tr>
       </table>
       <div style="margin-top:10px;padding-top:8px;border-top:1px solid #bbb">
         <div style="font-size:9px;font-weight:700;color:#555;line-height:1.35">Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</div>
         <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#444"><span>IVA contenido</span><span style="font-family:'Courier New',monospace;font-weight:700">${formatCurrency(Number(f.iva), mon)}</span></div>
       </div>`
    : `<table style="width:100%;border-collapse:collapse">
        <tr><td style="${trStyle}">Neto gravado</td><td style="${tdMonoR}">${formatCurrency(Number(f.subtotal), mon)}</td></tr>
        <tr><td style="${trStyle}">IVA 21%</td><td style="${tdMonoR}">${formatCurrency(Number(f.iva), mon)}</td></tr>
        <tr><td style="${trFinal}">TOTAL</td><td style="${trFinal};${tdFinalR}">${formatCurrency(Number(f.total), mon)}</td></tr>
       </table>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${tipoLabel} ${letraComprobante} ${compNum}</title>
<style>${baseStyles(c)}</style></head><body>
<div class="page">
${documentHeader(soc, {
  title: tipoLabel,
  number: compNum,
  date: formatDate(f.fecha),
  secondary: f.fecha_vencimiento ? `Vence ${formatDate(f.fecha_vencimiento)}` : "Original",
  marker: letraComprobante,
  centerMarker: true,
  markerCode: isManualX ? "Comprobante interno sin IVA" : `Código ${codTipo}`,
  fiscalDetails: true,
  contactEmail: soc.email,
})}

<table class="compact-strip">
  <tr>
    <td style="width:60%">
      <div class="compact-title">Cliente</div>
      <div class="compact-primary">${cli?.razon_social || "\u2014"}</div>
      ${(cli?.cuit || cli?.condicion_iva) ? `<div class="compact-line">${cli?.cuit ? `<span class="compact-label">CUIT</span>${cli.cuit}` : ""}${cli?.cuit && cli?.condicion_iva ? ` &nbsp;|&nbsp; ` : ""}${cli?.condicion_iva ? `<span class="compact-label">IVA</span>${cli.condicion_iva === "RI" ? "Responsable inscripto" : cli.condicion_iva}` : ""}</div>` : ""}
      ${cli?.direccion ? `<div class="compact-line"><span class="compact-label">Domicilio fiscal</span>${cli.direccion}${cli.localidad ? `, ${cli.localidad}` : ""}${cli.provincia ? `, ${cli.provincia}` : ""}</div>` : ""}
    </td>
    <td style="width:40%">
      <div class="compact-title">Datos del comprobante</div>
      ${f.condicion_venta ? `<div class="compact-line compact-line-aligned"><span class="compact-label">Pago</span><span>${f.condicion_venta}</span></div>` : ""}
      <div class="compact-line compact-line-aligned"><span class="compact-label">Moneda</span><span>${mon === "USD" ? "USD — Dólares estadounidenses" : "ARS — Pesos argentinos"}</span></div>
      ${isUSD ? `<div class="compact-line compact-line-aligned"><span class="compact-label">Cotización BNA</span><span>${f.cotizacion_modalidad === "billetes" ? "Billete" : "Divisa"} — $ ${Number(f.tipo_cambio).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ""}
      ${f.oc_cliente ? `<div class="compact-line compact-line-aligned"><span class="compact-label">OC cliente</span><span>${f.oc_cliente}</span></div>` : ""}
      ${fce ? `<div class="compact-line"><span class="compact-label">CBU de cobro</span>${fce.cbu}</div><div class="compact-line"><span class="compact-label">Transmisión FCE</span>${fce.transmision}</div><div class="compact-line"><span class="compact-label">Vencimiento de pago</span>${formatDate(fce.vencimiento)}</div>` : ""}
    </td>
  </tr>
</table>

<div class="items-title">Detalle de productos / servicios</div>
<table>
  <thead><tr>
    <th class="center" style="width:30px">#</th>
    <th>Descripción</th>
    <th class="right" style="width:55px">Cantidad</th>
    <th class="right" style="width:110px">P. Unitario</th>
    ${hideItemIva ? "" : `<th class="right" style="width:50px">IVA %</th>`}
    <th class="right" style="width:115px">Subtotal</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

${f.observaciones ? `<div class="obs-block"><div class="obs-title">Observaciones</div><div class="obs-text">${String(f.observaciones).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char).replace(/\n/g, "<br/>")}</div></div>` : ""}

<table style="width:100%;margin-top:14px;border-collapse:collapse">
  <tr><td></td><td style="width:260px">
    ${isUSD ? `<div style="font-size:9px;color:#444;padding:5px 0">Operación en USD — cotización BNA ${f.cotizacion_modalidad === "billetes" ? "billete" : "divisa"} — TC: ${Number(f.tipo_cambio).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : ""}
    ${totalsHtml}
  </td></tr>
</table>

${f.observaciones ? `<div class="obs-block"><div class="obs-title">Comprobante asociado / observaciones</div><div class="obs-text">${f.observaciones.replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char] || char))}</div></div>` : ""}

${fce ? `<div class="footer-legal"><strong>Son: ${importeEnLetras(Number(f.total),f.moneda)}.</strong><br/>${fce.remitos?.length ? `Remitos asociados: ${fce.remitos.map(n=>String(n).replace(/[&<>"']/g, "")).join(", ")}.<br/>` : ""}Esta Factura de Crédito Electrónica MiPyME se considerará aceptada si, al vencimiento del plazo de ${fce.plazoAceptacion || 21} días corridos desde su recepción en el domicilio fiscal electrónico del comprador o locatario, no se hubiera registrado su rechazo total o aceptación. Si al vencimiento no se hubiera registrado su cancelación, constituirá título ejecutivo en los términos del artículo 523 del Código Procesal Civil y Comercial de la Nación y concordantes. La aceptación expresa o tácita implica plena conformidad para transferir la información del documento desde el Registro de Facturas de Crédito Electrónicas MiPyMEs a terceros si el vendedor opta por su cesión, transmisión o negociación.</div>` : ""}
${f.cae ? `
<table style="width:100%;margin-top:20px;padding:14px 16px;border:1px solid #ddd;border-collapse:collapse">
  <tr>
    <td style="vertical-align:top">
      <div style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#444;font-weight:700">CAE N°</div>
      <div style="font-size:11px;font-weight:700;font-family:'Courier New',monospace;margin-top:2px;color:#222">${f.cae}</div>
      ${f.cae_vencimiento ? `<div style="font-size:9px;color:#444;margin-top:3px">Fecha de vto. de CAE: ${formatDate(f.cae_vencimiento)}</div>` : ""}
    </td>
    <td style="text-align:center;width:120px;vertical-align:top">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrUrl)}" alt="QR ARCA" style="width:100px;height:100px" />
      <div style="font-size:7px;color:#555;margin-top:2px">Comprobante autorizado</div>
    </td>
  </tr>
</table>` : ""}

${["MONOTRIBUTO","MONOTRIBUTISTA"].includes((cli?.condicion_iva || "").toUpperCase()) && letraComprobante === "A" ? `<div class="footer-legal">El crédito fiscal discriminado en el presente comprobante, solo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618.</div>` : ""}
${documentFooter(soc, `${tipoLabel} ${letraComprobante} N° ${compNum}`)}

</div></body></html>`;
}

// ────────────────────────────────────────────────────────────────
// REMITO PDF
// ────────────────────────────────────────────────────────────────
interface RemitoItemPDF {
  descripcion: string;
  cantidad: number;
  unidad: string | null;
}

interface TransportePDF {
  transportista: string;
  destino?: string | null;
  costo?: number | null;
  moneda?: string | null;
}

interface RemitoData {
  numero: string;
  fecha: string;
  cae?: string | null;
  cae_vencimiento?: string | null;
  nro_remito_afip?: string | null;
  oc_cliente?: string | null;
  valor_declarado?: number | null;
  observaciones?: string | null;
  // CAI fields
  cai_numero?: string | null;
  punto_venta_cai?: number | null;
  nro_comprobante_cai?: number | null;
  cai_vencimiento?: string | null;
  cuit_emisor?: string | null;
  cliente: {
    razon_social?: string;
    cuit?: string;
    condicion_iva?: string;
    direccion?: string;
    localidad?: string;
    provincia?: string;
  } | null;
  sucursal_nombre?: string | null;
  sucursal_direccion?: string | null;
  items: RemitoItemPDF[];
  transportes: TransportePDF[];
}

// Generate Interleaved 2 of 5 barcode as SVG (used by ARCA for CAI comprobantes)
function itf25Svg(digits: string): string {
  // ITF encoding patterns: N=narrow, W=wide
  const patterns: Record<string, string> = {
    "0":"NNWWN","1":"WNNNW","2":"NWNNW","3":"WWNNN","4":"NNWNW",
    "5":"WNWNN","6":"NWWNN","7":"NNNWW","8":"WNNWN","9":"NWNWN",
  };
  // Pad to even length
  let d = digits.length % 2 === 1 ? "0" + digits : digits;
  const narrow = 1, wide = 3;
  let bars: {w:number;black:boolean}[] = [];
  // Start pattern: narrow black, narrow white, narrow black, narrow white
  bars.push({w:narrow,black:true},{w:narrow,black:false},{w:narrow,black:true},{w:narrow,black:false});
  for (let i = 0; i < d.length; i += 2) {
    const bPat = patterns[d[i]];
    const sPat = patterns[d[i+1]];
    for (let j = 0; j < 5; j++) {
      bars.push({w: bPat[j]==="W" ? wide : narrow, black: true});
      bars.push({w: sPat[j]==="W" ? wide : narrow, black: false});
    }
  }
  // Stop pattern: wide black, narrow white, narrow black
  bars.push({w:wide,black:true},{w:narrow,black:false},{w:narrow,black:true});
  const totalW = bars.reduce((s,b) => s + b.w, 0);
  const svgW = 360, svgH = 50;
  const scale = svgW / totalW;
  let x = 0;
  let rects = "";
  for (const b of bars) {
    if (b.black) rects += `<rect x="${(x*scale).toFixed(1)}" y="0" width="${(b.w*scale).toFixed(1)}" height="${svgH}" fill="#000"/>`;
    x += b.w;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">${rects}</svg>`;
}

// Build the 42-digit ARCA barcode data for CAI comprobantes
function buildCaiBarcode(cuit: string, tipoComprobante: number, pv: number, cai: string, vtoDate: string): string {
  const c = cuit.replace(/\D/g, "").padStart(11, "0");
  const tipo = String(tipoComprobante).padStart(3, "0");
  const punto = String(pv).padStart(5, "0");
  const caiClean = cai.replace(/\D/g, "").padStart(14, "0");
  // vtoDate as YYYYMMDD
  const vto = vtoDate.replace(/\D/g, "").slice(0, 8);
  const raw = c + tipo + punto + caiClean + vto;
  // Verificador módulo 10
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    const digit = parseInt(raw[i]);
    // Posiciones impares (1-based) × 1, pares × 3
    sum += (i % 2 === 0) ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return raw + check;
}

export function generateRemitoPDF(
  r: RemitoData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const cli = r.cliente;
  const hasCAI = !!(r.cai_numero && r.punto_venta_cai && r.nro_comprobante_cai);

  const itemRows = r.items.length > 0
    ? r.items.map((it, i) => `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${it.descripcion}</td>
        <td class="right bold">${it.cantidad}</td>
        <td class="center">${it.unidad || "u"}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" style="text-align:center;color:#444;padding:24px;font-style:italic">Sin items</td></tr>`;

  // Delivery address logic
  const direccionEntrega = r.sucursal_nombre
    ? `${r.sucursal_nombre}${r.sucursal_direccion ? ` &mdash; ${r.sucursal_direccion}` : ""}`
    : (cli?.direccion ? `${cli.direccion}${cli.localidad ? `, ${cli.localidad}` : ""}${cli.provincia ? ` (${cli.provincia})` : ""}` : "");

  // Formatted PV-number for CAI remitos
  const pvStr = hasCAI ? String(r.punto_venta_cai).padStart(4, "0") : "";
  const nroStr = hasCAI ? String(r.nro_comprobante_cai).padStart(8, "0") : "";
  const displayNumber = hasCAI ? `${pvStr}-${nroStr}` : r.numero;

  // Barcode for CAI
  let barcodeHtml = "";
  if (hasCAI && r.cuit_emisor && r.cai_vencimiento) {
    const vtoForBarcode = r.cai_vencimiento.replace(/-/g, ""); // YYYYMMDD
    const barcodeData = buildCaiBarcode(r.cuit_emisor, 91, r.punto_venta_cai!, r.cai_numero!, vtoForBarcode);
    const svg = itf25Svg(barcodeData);
    const svgB64 = typeof btoa !== "undefined"
      ? `data:image/svg+xml;base64,${btoa(svg)}`
      : `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    barcodeHtml = `
      <div class="cai-section">
        <div>
          <div class="cai-label">CAI</div>
          <div class="cai-value">${r.cai_numero}</div>
          <div class="cai-vto">Fecha Vto. CAI: ${formatDate(r.cai_vencimiento)}</div>
        </div>
        <div style="text-align:center">
          <img src="${svgB64}" style="width:280px;height:40px" />
          <div style="font-size:8px;font-family:'Courier New',monospace;letter-spacing:1px;margin-top:2px">${barcodeData}</div>
        </div>
      </div>`;
  }

  // CAI section styles
  const caiStyles = hasCAI ? `
    .cai-section { margin-top: 20px; padding: 14px 16px; border: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
    .cai-label { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #444; font-weight: 700; }
    .cai-value { font-size: 11px; font-weight: 700; font-family: 'Courier New', Courier, monospace; margin-top: 2px; color: #222; }
    .cai-vto { font-size: 9px; color: #333; margin-top: 3px; }
  ` : "";

  // Authorization info in right panel
  const authInfo = hasCAI
    ? `<div class="compact-line"><span class="compact-label">CAI</span>${r.cai_numero}</div>
       <div class="compact-line"><span class="compact-label">Vto. CAI</span>${formatDate(r.cai_vencimiento!)}</div>`
    : r.cae
    ? `<div class="compact-line"><span class="compact-label">CAE</span>${r.cae}</div>
       ${r.cae_vencimiento ? `<div class="compact-line"><span class="compact-label">Vto. CAE</span>${formatDate(r.cae_vencimiento)}</div>` : ""}
       ${r.nro_remito_afip ? `<div class="compact-line"><span class="compact-label">Comp. ARCA</span>${r.nro_remito_afip}</div>` : ""}`
    : `<div class="compact-line"><span class="compact-label">Autorización</span>Remito interno</div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Remito ${displayNumber}</title>
<style>
  ${baseStyles(c)}
  .valor-declarado { background: #fff8e1; border: 2px solid #f9a825; border-radius: 6px; padding: 12px 16px; margin-top: 18px; font-size: 14px; font-weight: 700; color: #e65100; text-align: center; }
  .transport-grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .transport-item { flex: 1; min-width: 140px; }
  ${caiStyles}
</style></head><body>
<div class="page">
${documentHeader(soc, {
  title: hasCAI ? "Remito R" : "Remito",
  number: displayNumber,
  date: formatDate(r.fecha),
  secondary: "Original",
  marker: hasCAI ? "R" : (r.cae ? "R" : "X"),
  markerCode: hasCAI ? "Código 091 - Remito R" : (r.cae ? "Código 091 - Remito con CAE" : "Remito interno"),
  legalLegend: true,
  contactEmail: soc.commercialEmail,
})}

<table class="compact-strip">
  <tr>
    <td style="width:64%">
      <div class="compact-title">Destinatario</div>
      <div class="compact-primary">${cli?.razon_social || "\u2014"}</div>
      ${(cli?.cuit || cli?.condicion_iva) ? `<div class="compact-line">${cli?.cuit ? `<span class="compact-label">CUIT</span>${cli.cuit}` : ""}${cli?.cuit && cli?.condicion_iva ? ` &nbsp;|&nbsp; ` : ""}${cli?.condicion_iva ? `<span class="compact-label">IVA</span>${cli.condicion_iva}` : ""}</div>` : ""}
      ${direccionEntrega ? `<div class="compact-line"><span class="compact-label">Entrega</span>${direccionEntrega}</div>` : ""}
    </td>
    <td style="width:36%">
      <div class="compact-title">Datos del remito</div>
      ${r.oc_cliente ? `<div class="compact-line"><span class="compact-label">OC cliente</span>${r.oc_cliente}</div>` : ""}
      ${r.transportes.length > 0 ? r.transportes.map(t => `
        <div class="compact-line"><span class="compact-label">Transportista</span>${t.transportista}</div>
        ${t.destino ? `<div class="compact-line"><span class="compact-label">Destino</span>${t.destino}</div>` : ""}
      `).join("") : `<div class="compact-line" style="color:#444;font-style:italic">Sin transporte asignado</div>`}
      ${authInfo}
    </td>
  </tr>
</table>

<div class="items-title">Detalle de mercadería</div>
<table>
  <thead><tr>
    <th class="center" style="width:36px">#</th>
    <th>Descripción</th>
    <th class="right" style="width:80px">Cantidad</th>
    <th class="center" style="width:65px">Unidad</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

${r.valor_declarado ? `<div class="valor-declarado">VALOR DECLARADO: $ ${Number(r.valor_declarado).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : ""}

${r.observaciones ? `<div class="obs-block"><div class="obs-title">Observaciones</div><div class="obs-text">${r.observaciones}</div></div>` : ""}

<table style="width:100%;margin-top:48px;border-collapse:collapse">
  <tr>
    <td style="width:90px;font-size:10px;color:#666"><b>Bultos:</b> ______</td>
    <td style="width:180px;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:10px;color:#666">Firma y aclaración del emisor</td>
    <td></td>
    <td style="width:180px;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:10px;color:#666">Firma y aclaración del receptor</td>
  </tr>
</table>

${barcodeHtml}

${documentFooter(soc, displayNumber)}
<div class="footer-legal">Recibí conforme la mercadería detallada precedentemente.</div>

</div></body></html>`;
}

// ────────────────────────────────────────────────────────────────
// ORDEN DE COMPRA PDF
// ────────────────────────────────────────────────────────────────
interface OCItemPDF {
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad?: string | null;
  precio_unitario: number;
  subtotal: number;
}

interface OCData {
  numero: string;
  fecha: string;
  fecha_entrega_estimada?: string | null;
  estado: string;
  estadoLabel: string;
  moneda: "ARS" | "USD";
  subtotal: number;
  iva: number;
  total: number;
  observaciones?: string | null;
  presupuesto_origen?: { numero: string } | null;
  proveedor: {
    razon_social?: string | null;
    cuit?: string | null;
    condicion_iva?: string | null;
    direccion?: string | null;
    localidad?: string | null;
    provincia?: string | null;
    email?: string | null;
    telefono?: string | null;
    forma_pago?: string | null;
  } | null;
  items: OCItemPDF[];
}

export function generateOrdenCompraPDF(
  oc: OCData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const mon = oc.moneda;
  const prov = oc.proveedor;

  const itemRows = oc.items.map((it, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td class="mono">${it.codigo || ""}</td>
      <td>${it.descripcion}</td>
      <td class="right">${it.cantidad}</td>
      <td class="center">${it.unidad || "u"}</td>
      <td class="right mono">${formatCurrency(Number(it.precio_unitario), mon)}</td>
      <td class="right mono bold">${formatCurrency(Number(it.subtotal), mon)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${oc.numero} - ${soc.razonSocial}</title>
<style>${baseStyles(c)}</style></head><body>
<div class="page">
${documentHeader(soc, {
  title: "Orden de compra",
  number: oc.numero,
  date: formatDate(oc.fecha),
  secondary: oc.fecha_entrega_estimada ? `Entrega ${formatDate(oc.fecha_entrega_estimada)}` : "",
  badge: oc.estadoLabel,
  marker: "OC",
  legalLegend: true,
  contactEmail: soc.commercialEmail,
})}

<table class="compact-strip">
  <tr>
    <td style="width:64%">
      <div class="compact-title">Proveedor</div>
      <div class="compact-primary">${prov?.razon_social || "\u2014"}</div>
      ${(prov?.cuit || prov?.condicion_iva) ? `<div class="compact-line">${prov?.cuit ? `<span class="compact-label">CUIT</span>${prov.cuit}` : ""}${prov?.cuit && prov?.condicion_iva ? ` &nbsp;|&nbsp; ` : ""}${prov?.condicion_iva ? `<span class="compact-label">IVA</span>${prov.condicion_iva}` : ""}</div>` : ""}
      ${prov?.direccion ? `<div class="compact-line"><span class="compact-label">Domicilio</span>${prov.direccion}${prov.localidad ? `, ${prov.localidad}` : ""}${prov.provincia ? ` (${prov.provincia})` : ""}</div>` : ""}
    </td>
    <td style="width:36%">
      <div class="compact-title">Datos de la orden</div>
      ${prov?.forma_pago ? `<div class="compact-line"><span class="compact-label">Pago</span>${prov.forma_pago}</div>` : ""}
      <div class="compact-line"><span class="compact-label">Moneda</span>${mon === "USD" ? "Dólares estadounidenses" : "Pesos argentinos"}</div>
      ${oc.presupuesto_origen ? `<div class="compact-line"><span class="compact-label">PR origen</span>${oc.presupuesto_origen.numero}</div>` : ""}
    </td>
  </tr>
</table>

<div style="margin:10px 0 12px;padding:9px 12px;border:2px solid ${c};border-radius:6px;font-size:12px;font-weight:700;color:#111;text-align:center">
  IMPORTANTE: por favor indicar el N° de orden de compra <span style="color:${c};font-size:13px">${oc.numero}</span> en la factura (y en el remito).
</div>

<div class="items-title">Detalle de productos / servicios</div>
<table>
  <thead><tr>
    <th class="center" style="width:30px">#</th>
    <th style="width:72px">Código</th>
    <th>Descripción</th>
    <th class="right" style="width:45px">Cant.</th>
    <th class="center" style="width:40px">Unid.</th>
    <th class="right" style="width:110px">P. Unitario</th>
    <th class="right" style="width:115px">Subtotal</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<table style="width:100%;margin-top:14px;border-collapse:collapse">
  <tr><td></td><td style="width:260px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="font-size:11px;color:#333;padding:5px 0">Subtotal</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(Number(oc.subtotal), mon)}</td></tr>
      <tr><td style="font-size:11px;color:#333;padding:5px 0">IVA</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(Number(oc.iva), mon)}</td></tr>
      <tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">TOTAL (${mon})</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(Number(oc.total), mon)}</td></tr>
    </table>
  </td></tr>
</table>

${oc.observaciones ? `<div class="obs-block"><div class="obs-title">Observaciones</div><div class="obs-text">${oc.observaciones}</div></div>` : ""}

${documentFooter(soc, oc.numero)}

</div></body></html>`;
}

// ────────────────────────────────────────────────────────────────
// ORDEN DE PAGO PDF
// ────────────────────────────────────────────────────────────────
interface OPMedio {
  tipo: string;
  monto: number;
  fecha: string;
  banco?: string;
  numero_cheque?: string;
  moneda: "ARS" | "USD";
  cotizacion?: number;
}

interface OPFacturaVinculada {
  numero: string;
  fecha: string;
  monto: number;
  detalle?: string;
}

interface OPData {
  numero: string;
  fecha: string;
  estado: string;
  moneda: "ARS" | "USD";
  monto_bruto: number;
  retencion_ganancias_pct: number;
  retencion_ganancias_monto: number;
  neto: number;
  notas?: string;
  proveedor: {
    razon_social: string;
    cuit?: string;
    direccion?: string;
  };
  medios: OPMedio[];
  facturas_vinculadas: OPFacturaVinculada[];
}

// ── Monto en letras (Spanish) ──────────────────────────────────
export function montoEnLetras(monto: number, moneda: "ARS" | "USD"): string {
  const unidades = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  const decenas = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

  const convertirGrupo = (n: number): string => {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    let result = "";
    if (n >= 100) { result += centenas[Math.floor(n / 100)] + " "; n = n % 100; }
    if (n >= 20) {
      result += decenas[Math.floor(n / 10)];
      if (n % 10 > 0) result += (Math.floor(n / 10) === 2 ? "I" : " Y ") + unidades[n % 10];
    } else if (n >= 10) {
      result += especiales[n - 10];
    } else if (n > 0) {
      result += unidades[n];
    }
    return result.trim();
  };

  const entero = Math.floor(Math.abs(monto));
  const centavos = Math.round((Math.abs(monto) - entero) * 100);
  const monedaLabel = moneda === "USD" ? "DOLARES ESTADOUNIDENSES" : "PESOS ARGENTINOS";

  if (entero === 0) return `SON ${monedaLabel} CERO CON ${String(centavos).padStart(2, "0")}/100 CENTAVOS`;

  let texto = "";
  const millones = Math.floor(entero / 1000000);
  const miles = Math.floor((entero % 1000000) / 1000);
  const resto = entero % 1000;

  if (millones > 0) {
    texto += (millones === 1 ? "UN MILLON" : convertirGrupo(millones) + " MILLONES") + " ";
  }
  if (miles > 0) {
    texto += (miles === 1 ? "MIL" : convertirGrupo(miles) + " MIL") + " ";
  }
  if (resto > 0) {
    texto += convertirGrupo(resto);
  }

  return `SON ${monedaLabel} ${texto.trim()} CON ${String(centavos).padStart(2, "0")}/100 CENTAVOS`;
}

// ── Format CUIT for display (XX-XXXXXXXX-X) ──
function fmtCuit(c: string): string {
  const digits = c.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0,2)}-${digits.slice(2,10)}-${digits.slice(10)}`;
  return c;
}

// ── Format date as DD/MM/YYYY ──
function fechaDD(f: string): string {
  try {
    const d = new Date(f + "T12:00:00");
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  } catch { return f; }
}

export interface ReciboData {
  numero: string;
  fecha: string;
  cliente: string;
  descripcion: string;
  medio: string;
  monto: number;
  moneda: "ARS" | "USD";
  conciliado: boolean;
}

function textoSeguro(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generateReciboPDF(recibo: ReciboData, soc: SociedadPDF): string {
  const referencia = recibo.numero.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "CLIENTE";
  const numero = `REC-${recibo.fecha.replace(/\D/g, "")}-${referencia}`;
  const monedaLabel = recibo.moneda === "USD" ? "Dólares estadounidenses" : "Pesos argentinos";
  const estado = recibo.conciliado ? "Conciliado" : "Pendiente de conciliación";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Recibo ${numero} - ${textoSeguro(soc.razonSocial)}</title>
<style>${baseStyles(soc.colorPrimario)}</style></head><body>
<div class="page">
${documentHeader(soc, {
  title: "Recibo de cobro",
  number: numero,
  date: formatDate(recibo.fecha),
  badge: estado,
  legalLegend: true,
  fiscalDetails: true,
})}
<table class="compact-strip">
  <tr>
    <td style="width:64%">
      <div class="compact-title">Recibimos de</div>
      <div class="compact-primary">${textoSeguro(recibo.cliente)}</div>
      <div class="compact-line"><span class="compact-label">Concepto</span>${textoSeguro(recibo.descripcion)}</div>
    </td>
    <td style="width:36%">
      <div class="compact-title">Datos del cobro</div>
      <div class="compact-line"><span class="compact-label">Medio</span>${textoSeguro(recibo.medio)}</div>
      <div class="compact-line"><span class="compact-label">Moneda</span>${monedaLabel}</div>
    </td>
  </tr>
</table>
<div class="items-title">Importe recibido</div>
<table style="table-layout:fixed">
  <thead><tr><th>Descripción</th><th class="center" style="width:76px">Moneda</th><th class="right" style="width:160px">Importe</th></tr></thead>
  <tbody><tr><td>${textoSeguro(recibo.descripcion)}</td><td class="center" style="white-space:nowrap;word-break:normal;overflow-wrap:normal">${recibo.moneda}</td><td class="right mono bold" style="white-space:nowrap;word-break:normal;overflow-wrap:normal">${formatCurrency(recibo.monto, recibo.moneda)}</td></tr></tbody>
</table>
<div class="obs-block">
  <div class="obs-title">Importe en letras</div>
  <div class="obs-text">${montoEnLetras(recibo.monto, recibo.moneda)}</div>
</div>
<table style="width:100%;margin-top:60px;border-collapse:collapse"><tr><td style="width:180px;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:10px;color:#666">Firma y aclaración</td><td></td></tr></table>
${documentFooter(soc, `Recibo ${numero}`)}
</div></body></html>`;
}

export function generateOrdenPagoPDF(op: OPData, soc: SociedadPDF): string {
  const c = soc.colorPrimario;
  const mon = op.moneda;

  // Separate medios by type
  const cheques = op.medios.filter((m) => m.tipo === "cheque" || m.tipo === "cheque_propio" || m.tipo === "echeq");
  const pagosDirectos = op.medios.filter((m) => m.tipo === "deposito" || m.tipo === "transferencia" || m.tipo === "efectivo" || m.tipo === "tarjeta");
  const medioLabel: Record<string, string> = {
    deposito: "Depósito",
    transferencia: "Transferencia",
    efectivo: "Efectivo",
    tarjeta: "Tarjeta",
  };

  const totalCheques = cheques.reduce((s, m) => s + Number(m.monto), 0);
  const totalPagosDirectos = pagosDirectos.reduce((s, m) => s + Number(m.monto), 0);
  const totalRetGan = op.retencion_ganancias_monto || 0;
  const totalRetenciones = totalRetGan;
  const totalGeneral = totalCheques + totalPagosDirectos + totalRetenciones;
  const esLiquidacionFx = op.numero.startsWith("OP-FX-") || op.notas?.startsWith("Liquidación USD/ARS.");
  const saldoFavorGenerado = !esLiquidacionFx && op.estado !== "anulada"
    ? Math.max(0, totalGeneral - Number(op.monto_bruto))
    : 0;

  const estadoLabel: Record<string, string> = { pendiente: "Pendiente", pagada: "Pagada", anulada: "Anulada" };

  // ── FCs table ──
  const fcsHtml = op.facturas_vinculadas.length > 0
    ? `<table>
        <thead><tr><th class="center">Fecha</th><th>Comprobante</th><th class="right">Monto abonado</th></tr></thead>
        <tbody>${op.facturas_vinculadas.map(fc => `<tr><td class="center">${fechaDD(fc.fecha)}</td><td>${textoSeguro(fc.numero)}${fc.detalle ? `<div style="font-size:9px;color:#666;margin-top:2px">${textoSeguro(fc.detalle)}</div>` : ""}</td><td class="right mono">${formatCurrency(fc.monto, mon)}</td></tr>`).join("")}</tbody>
      </table>`
    : `<p style="color:#444;font-size:11px;margin-top:6px">Sin documentos vinculados</p>`;

  // ── Cheques table ──
  const chequesHtml = cheques.length > 0 ? `
    <div style="margin-top:18px">
      <div class="items-title">Cheques</div>
      <table>
        <thead><tr>
          <th>Fecha</th><th>Banco</th><th>N\u00B0 Cheque</th><th>Moneda</th><th class="right">Importe</th><th class="right">Cotiz.</th><th class="right">Consolidado</th>
        </tr></thead>
        <tbody>${cheques.map((m) => {
          const cons = Number(m.monto) * (Number(m.cotizacion) || 1);
          return `<tr>
            <td>${fechaDD(m.fecha)}</td><td>${m.banco || "\u2014"}</td><td class="mono">${m.numero_cheque || "\u2014"}</td><td class="center">${m.moneda || mon}</td>
            <td class="right mono">${formatCurrency(Number(m.monto), m.moneda || mon)}</td>
            <td class="right mono">${Number(m.cotizacion) || 1}</td>
            <td class="right mono bold">${formatCurrency(cons, "ARS")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
      <table style="width:100%;margin-top:14px;border-collapse:collapse"><tr><td></td><td style="width:260px"><table style="width:100%;border-collapse:collapse"><tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">Total Cheques</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(totalCheques, mon)}</td></tr></table></td></tr></table>
    </div>` : "";

  // ── Pagos directos table ──
  const pagosDirectosHtml = pagosDirectos.length > 0 ? `
    <div style="margin-top:18px">
      <div class="items-title">Pagos directos</div>
      <table>
        <thead><tr>
          <th>Fecha</th><th>Medio</th><th>Moneda</th><th class="right">Importe</th><th class="right">Cotiz.</th><th class="right">Consolidado</th>
        </tr></thead>
        <tbody>${pagosDirectos.map((m) => {
          const cons = Number(m.monto) * (Number(m.cotizacion) || 1);
          return `<tr>
            <td>${fechaDD(m.fecha)}</td><td>${medioLabel[m.tipo] || m.tipo}</td><td class="center">${m.moneda || mon}</td>
            <td class="right mono">${formatCurrency(Number(m.monto), m.moneda || mon)}</td>
            <td class="right mono">${Number(m.cotizacion) || 1}</td>
            <td class="right mono bold">${formatCurrency(cons, "ARS")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
      <table style="width:100%;margin-top:14px;border-collapse:collapse"><tr><td></td><td style="width:260px"><table style="width:100%;border-collapse:collapse"><tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">Total pagos directos</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(totalPagosDirectos, mon)}</td></tr></table></td></tr></table>
    </div>` : "";

  // ── Retenciones table ──
  const retencionesItems: { fecha: string; desc: string; monto: number }[] = [];
  if (totalRetGan > 0) retencionesItems.push({ fecha: op.fecha, desc: `Retenci\u00F3n Ganancias (${op.retencion_ganancias_pct}%)`, monto: totalRetGan });

  const retencionesHtml = retencionesItems.length > 0 ? `
    <div style="margin-top:18px">
      <div class="items-title">Retenciones</div>
      <table>
        <thead><tr><th>Fecha</th><th>Descripci\u00F3n</th><th>Moneda</th><th class="right">Importe</th></tr></thead>
        <tbody>${retencionesItems.map(r => `<tr><td>${fechaDD(r.fecha)}</td><td>${r.desc}</td><td class="center">${mon}</td><td class="right mono bold">${formatCurrency(r.monto, mon)}</td></tr>`).join("")}</tbody>
      </table>
      <table style="width:100%;margin-top:14px;border-collapse:collapse"><tr><td></td><td style="width:260px"><table style="width:100%;border-collapse:collapse"><tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">Total Retenciones</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(totalRetenciones, mon)}</td></tr></table></td></tr></table>
    </div>` : "";

  // ── Totals ──
  const totalsHtml = `
    <table style="width:100%;margin-top:24px;border-collapse:collapse">
      <tr><td></td><td style="width:260px">
        <table style="width:100%;border-collapse:collapse">
          ${totalCheques > 0 ? `<tr><td style="font-size:11px;color:#333;padding:5px 0">Total Cheques</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(totalCheques, mon)}</td></tr>` : ""}
          ${totalPagosDirectos > 0 ? `<tr><td style="font-size:11px;color:#333;padding:5px 0">Total pagos directos</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(totalPagosDirectos, mon)}</td></tr>` : ""}
          ${totalRetenciones > 0 ? `<tr><td style="font-size:11px;color:#333;padding:5px 0">Total Retenciones</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111">${formatCurrency(totalRetenciones, mon)}</td></tr>` : ""}
          <tr><td style="font-size:12px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222">TOTAL (${mon})</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:12px;font-weight:700;padding:8px 0;border-top:2px solid #222">${formatCurrency(totalGeneral, mon)}</td></tr>
          ${saldoFavorGenerado > 0.01 ? `<tr><td style="font-size:11px;font-weight:700;color:#047857;padding:7px 0">Crédito a nuestro favor</td><td style="text-align:right;font-family:'Courier New',monospace;font-size:11px;font-weight:700;color:#047857">${formatCurrency(saldoFavorGenerado, mon)}</td></tr>` : ""}
        </table>
      </td></tr>
    </table>`;

  // ── Monto en letras ──
  const letrasHtml = `<div style="font-size:10px;font-style:italic;color:#666;margin-top:10px">${montoEnLetras(totalGeneral, mon)}</div>`;

  // ── Certificado retención ganancias (page 2) ──
  const certHtml = totalRetGan > 0 ? `
    <div class="page" style="page-break-before:always;padding-top:20px">
      <div class="header-bar"></div>
      <table style="width:100%;border-bottom:2px solid #e0e0e0;margin-bottom:18px;padding:16px 0 14px;border-collapse:collapse">
        <tr>
          <td style="vertical-align:top">
            <img src="${LAZZARI_LOGO_B64}" alt="${soc.nombre}" style="height:42px;margin-bottom:4px" />
            <div class="company-sub">${soc.razonSocial}</div>
          </td>
          <td style="text-align:right;vertical-align:top">
            <div class="doc-title">Cert. Ret. Impuesto a las Ganancias</div>
            <div class="doc-number">${op.numero || "\u2014"}</div>
            <div class="doc-date">${fechaDD(op.fecha)} &mdash; CUIT: ${soc.cuit}</div>
          </td>
        </tr>
      </table>

      <table style="width:100%;margin-bottom:18px;border-collapse:separate;border-spacing:16px 0">
        <tr>
          <td style="width:50%;border:1px solid #e0e0e0;border-radius:6px;padding:12px 14px;vertical-align:top">
            <div style="font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:${c};font-weight:700;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #f0f0f0">A - Agente de retenci\u00F3n</div>
            <div class="info-row"><div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:#444;font-weight:600">Raz\u00F3n Social</div><div style="font-size:11px;font-weight:500;color:#333">${soc.razonSocial}</div></div>
            <div class="info-row"><div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:#444;font-weight:600">CUIT</div><div style="font-size:11px;font-weight:500;color:#333">${soc.cuit}</div></div>
            <div class="info-row"><div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:#444;font-weight:600">Domicilio</div><div style="font-size:11px;font-weight:500;color:#333">${soc.domicilio}</div></div>
          </td>
          <td style="width:50%;border:1px solid #e0e0e0;border-radius:6px;padding:12px 14px;vertical-align:top">
            <div style="font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:${c};font-weight:700;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #f0f0f0">B - Sujeto retenido</div>
            <div class="info-row"><div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:#444;font-weight:600">Raz\u00F3n Social</div><div style="font-size:11px;font-weight:500;color:#333">${op.proveedor.razon_social}</div></div>
            <div class="info-row"><div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:#444;font-weight:600">CUIT</div><div style="font-size:11px;font-weight:500;color:#333">${op.proveedor.cuit ? fmtCuit(op.proveedor.cuit) : "\u2014"}</div></div>
            <div class="info-row"><div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:#444;font-weight:600">Domicilio</div><div style="font-size:11px;font-weight:500;color:#333">${op.proveedor.direccion || "\u2014"}</div></div>
          </td>
        </tr>
      </table>

      <div class="items-title">C - Datos de la retenci\u00F3n</div>
      <table>
        <tbody>
          <tr><td class="bold" style="width:240px">R\u00E9gimen</td><td>78 - Anexo II, inc. f) Enajenaci\u00F3n de bienes muebles y bienes de cambio</td></tr>
          <tr><td class="bold">Importe sujeto a retenci\u00F3n</td><td class="mono">${formatCurrency(op.monto_bruto, mon)}</td></tr>
          <tr><td class="bold">Importe retenido</td><td class="mono bold">${formatCurrency(totalRetGan, mon)}</td></tr>
          <tr><td class="bold">Documentos que originan la retenci\u00F3n</td><td>${op.numero || "\u2014"} (${formatCurrency(totalGeneral, mon)})</td></tr>
        </tbody>
      </table>

      <div style="font-size:10px;font-style:italic;color:#666;margin-top:14px;border:1px solid #e0e0e0;border-radius:6px;padding:10px 14px;background:#f9f9f9">
        ${montoEnLetras(totalRetGan, mon)}
      </div>

      <table style="width:100%;margin-top:60px;border-collapse:collapse">
        <tr>
          <td style="width:180px;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:10px;color:#666">Firma y aclaraci\u00F3n</td>
          <td></td>
        </tr>
      </table>

      ${documentFooter(soc, `Certificado Ret. Ganancias - OP ${op.numero || ""}`)}
    </div>` : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OP ${op.numero || ""} - ${soc.razonSocial}</title>
<style>${baseStyles(c)}</style></head><body>
<div class="page">
${documentHeader(soc, {
  title: "Orden de pago",
  number: op.numero || "\u2014",
  date: formatDate(op.fecha),
  badge: estadoLabel[op.estado] || op.estado,
  legalLegend: true,
  fiscalDetails: true,
})}

<table class="compact-strip">
  <tr>
    <td style="width:64%">
      <div class="compact-title">Proveedor</div>
      <div class="compact-primary">${op.proveedor.razon_social}</div>
      ${op.proveedor.cuit ? `<div class="compact-line"><span class="compact-label">CUIT</span>${fmtCuit(op.proveedor.cuit)}</div>` : ""}
      ${op.proveedor.direccion ? `<div class="compact-line"><span class="compact-label">Domicilio</span>${op.proveedor.direccion}</div>` : ""}
    </td>
    <td style="width:36%">
      <div class="compact-title">Datos del pago</div>
      <div class="compact-line"><span class="compact-label">Moneda</span>${mon === "USD" ? "D\u00F3lares estadounidenses" : "Pesos argentinos"}</div>
      ${op.notas ? `<div class="compact-line"><span class="compact-label">Notas</span>${op.notas}</div>` : ""}
    </td>
  </tr>
</table>

<div class="items-title">Documentos abonados</div>
${fcsHtml}

${chequesHtml}
${pagosDirectosHtml}
${retencionesHtml}

${totalsHtml}
${letrasHtml}

<table style="width:100%;margin-top:34px;border-collapse:collapse">
  <tr>
    <td style="width:180px;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:10px;color:#666">Firma y aclaraci\u00F3n</td>
    <td></td>
  </tr>
</table>

${documentFooter(soc, `OP ${op.numero || ""}`)}

</div>
${certHtml}
</body></html>`;
}

// ── Document filename helper ────────────────────────────────────
const DOC_TYPE_NAMES: Record<string, string> = {
  FA: "Factura-A", FB: "Factura-B", FCEA: "FacturaDeCreditoElectronica-A", FCEB: "FacturaDeCreditoElectronica-B",
  NCA: "NotaDeCredito-A", NCB: "NotaDeCredito-B", NCEA: "NotaDeCreditoElectronica-A", NCEB: "NotaDeCreditoElectronica-B",
  NDA: "NotaDeDebito-A", NDB: "NotaDeDebito-B", X: "Factura-X",
};

export function documentFilename(tipo: string, pv: number, numero: number, razonSocial?: string): string {
  const tipoName = DOC_TYPE_NAMES[tipo] || tipo;
  const pvStr = String(pv).padStart(4, "0");
  const numStr = String(numero).padStart(8, "0");
  const cliente = (razonSocial || "").replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, "").replace(/\s+/g, "").slice(0, 40);
  return `${tipoName}-${pvStr}-${numStr}${cliente ? `-${cliente}` : ""}.pdf`;
}

// ── Helper to generate and download the actual PDF ──────────────
export async function openPDFWindow(html: string, filename?: string, preview?: boolean) {
  try {
    const base64 = await htmlToPdfBase64(html);
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    if (preview) {
      window.open(url, "_blank");
    } else {
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "documento";
      const safeName = (filename || `${title}.pdf`).replace(/[\\/:*?"<>|]+/g, "-");
      const link = document.createElement("a");
      link.href = url;
      link.download = safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    console.error("No se pudo generar el PDF:", error);
    window.alert("No se pudo descargar el PDF. Intentá nuevamente.");
  }
}

// ── Helper to convert HTML to PDF base64 (client-side) ──────────
export async function htmlToPdfBase64(html: string): Promise<string> {
  const html2pdf = (await import("html2pdf.js")).default;

  // Offscreen container for html2canvas — must be in DOM and "visible" (not display:none).
  // Fixed positioning keeps the renderer out of page layout. Never change the
  // host body's styles: it may already be locked by an open email modal.
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;left:0;top:0;z-index:-9999;background:#fff;width:794px;overflow:hidden;pointer-events:none;";

  // Extract <style> blocks and <body> content from full HTML document
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];

  const renderId = crypto.randomUUID();
  const styleEl = document.createElement("style");
  styleEl.textContent = scopePdfStyles(styleMatches.map(m => m[1]).join("\n"), `[data-pdf-render="${renderId}"]`);

  // Container simulates <body> with proper width for A4
  const container = document.createElement("div");
  container.className = "pdf-root";
  container.setAttribute("data-pdf-render", renderId);
  container.style.cssText = "width:794px;background:#fff;";
  container.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  // Keep scoped styles with the root so html2pdf's clone retains them too.
  container.prepend(styleEl);
  overlay.appendChild(container);

  document.body.appendChild(overlay);
  let worker: any;
  try {
  // Wait for every image (including the ARCA QR) before rasterizing.
  const images = Array.from(container.querySelectorAll("img"));
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      window.setTimeout(done, 3000);
    });
  }));
  await new Promise(r => setTimeout(r, 100));

    worker = html2pdf()
      .set({
        margin: [0, 0, 0, 0],
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 1.5,
          useCORS: true,
          letterRendering: true,
          backgroundColor: "#ffffff",
          width: 794,
          windowWidth: 794,
        },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      } as any)
      .from(container);
    const blob: Blob = await worker.outputPdf("blob");

    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } finally {
    // html2pdf normally removes its own overlay on success, but not every failure.
    worker?.prop?.overlay?.remove();
    overlay.remove();
  }
}
