"""
Chart generation — 15 types via matplotlib.
bar, horizontal_bar, stacked_bar, pie, donut,
line, area, histogram, scatter, box_plot,
heatmap, treemap, waterfall, funnel, table
"""
import logging
from pathlib import Path
from typing import Dict, List, Optional
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

log = logging.getLogger(__name__)
PALETTE = ["#1D9E75","#378ADD","#D85A30","#BA7517","#7F77DD","#D4537E","#5DCAA5","#85B7EB","#F0997B","#C0DD97"]
plt.rcParams.update({
    "figure.facecolor":"white","axes.facecolor":"white","axes.edgecolor":"#CCCCCC",
    "axes.spines.top":False,"axes.spines.right":False,"axes.grid":True,
    "grid.color":"#EEEEEE","grid.linewidth":0.7,"font.family":"sans-serif","font.size":10,
    "axes.titlesize":12,"axes.titleweight":"bold","axes.titleloc":"left","axes.titlepad":10,
})
CHART_DIR = Path("data/processed/charts")

def generate_chart(chart_cfg: Dict, df: pd.DataFrame, out_dir: Path = CHART_DIR) -> Optional[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    name = chart_cfg.get("name","chart"); chart_type = chart_cfg.get("type","bar")
    title = chart_cfg.get("title",name); questions = chart_cfg.get("questions",[])
    opts = chart_cfg.get("options",{}); out_path = out_dir / f"{name}.png"
    missing = [q for q in questions if q not in df.columns]
    if missing: log.warning(f"Chart '{name}': columns not found: {missing}"); return None
    try:
        fn = CHART_DISPATCH.get(chart_type)
        if not fn: log.warning(f"Unknown chart type '{chart_type}'"); return None
        fn(df, questions, title, out_path, opts)
        log.info(f"  Chart generated: {name} ({chart_type})")
        return out_path
    except Exception as e:
        log.error(f"  Chart '{name}' failed: {e}"); return None

def _fs(o,d=(7,4)): return (o.get("width_inches",d[0]),o.get("height_inches",d[1]))
def _top(s,n=15): return s.value_counts().head(n)

def chart_bar(df,q,title,out,opts):
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",15)).sort_values()
    fig,ax=plt.subplots(figsize=_fs(opts)); ax.bar(counts.index,counts.values,color=PALETTE[0],alpha=0.87)
    ax.set_title(title); ax.set_xlabel(c); ax.set_ylabel("Count"); plt.xticks(rotation=30,ha="right")
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_horizontal_bar(df,q,title,out,opts):
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",15)).sort_values()
    fig,ax=plt.subplots(figsize=_fs(opts,(7,max(3,len(counts)*0.4))))
    bars=ax.barh(counts.index,counts.values,color=PALETTE[0],alpha=0.87)
    for b in bars:
        w=b.get_width(); ax.text(w+max(counts.values)*0.01,b.get_y()+b.get_height()/2,f"{int(w)}",va="center",fontsize=9)
    ax.set_title(title); ax.set_xlabel("Count"); ax.margins(x=0.12)
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_stacked_bar(df,q,title,out,opts):
    if len(q)<2: raise ValueError("stacked_bar needs 2 questions")
    x,s=q[0],q[1]; pivot=pd.crosstab(df[x],df[s])
    top_x=df[x].value_counts().head(opts.get("top_n",10)).index; pivot=pivot.loc[pivot.index.isin(top_x)]
    fig,ax=plt.subplots(figsize=_fs(opts,(8,5)))
    pivot.plot(kind="bar",stacked=True,ax=ax,color=PALETTE[:len(pivot.columns)],alpha=0.87)
    ax.set_title(title); ax.legend(title=s,bbox_to_anchor=(1.01,1),loc="upper left",fontsize=9)
    plt.xticks(rotation=30,ha="right"); plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_pie(df,q,title,out,opts):
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",8))
    fig,ax=plt.subplots(figsize=_fs(opts,(6,5)))
    _,_,at=ax.pie(counts.values,labels=counts.index,colors=PALETTE[:len(counts)],autopct="%1.1f%%",startangle=90,pctdistance=0.82)
    for t in at: t.set_fontsize(9); t.set_color("white")
    ax.set_title(title); plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_donut(df,q,title,out,opts):
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",8))
    fig,ax=plt.subplots(figsize=_fs(opts,(6,5)))
    _,_,at=ax.pie(counts.values,labels=counts.index,colors=PALETTE[:len(counts)],autopct="%1.1f%%",startangle=90,pctdistance=0.75,wedgeprops={"width":0.5})
    for t in at: t.set_fontsize(9); t.set_color("white")
    ax.set_title(title); plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_line(df,q,title,out,opts):
    x=q[0]; y=q[1] if len(q)>1 else None
    fig,ax=plt.subplots(figsize=_fs(opts,(8,4)))
    if y:
        tmp=df[[x,y]].dropna().sort_values(x); ax.plot(tmp[x],tmp[y],color=PALETTE[0],linewidth=2,marker="o",markersize=4); ax.set_ylabel(y)
    else:
        cnt=df[x].value_counts().sort_index(); ax.plot(cnt.index,cnt.values,color=PALETTE[0],linewidth=2,marker="o",markersize=4); ax.set_ylabel("Count")
    ax.set_title(title); ax.set_xlabel(x); plt.xticks(rotation=30,ha="right")
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_area(df,q,title,out,opts):
    x=q[0]; y=q[1] if len(q)>1 else None
    fig,ax=plt.subplots(figsize=_fs(opts,(8,4)))
    if y:
        tmp=df[[x,y]].dropna().sort_values(x)
        ax.fill_between(tmp[x],tmp[y],alpha=0.4,color=PALETTE[0]); ax.plot(tmp[x],tmp[y],color=PALETTE[0],linewidth=1.5); ax.set_ylabel(y)
    else:
        cnt=df[x].value_counts().sort_index()
        ax.fill_between(cnt.index,cnt.values,alpha=0.4,color=PALETTE[0]); ax.plot(cnt.index,cnt.values,color=PALETTE[0],linewidth=1.5); ax.set_ylabel("Count")
    ax.set_title(title); ax.set_xlabel(x); plt.xticks(rotation=30,ha="right")
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_histogram(df,q,title,out,opts):
    c=q[0]; series=pd.to_numeric(df[c],errors="coerce").dropna()
    fig,ax=plt.subplots(figsize=_fs(opts))
    ax.hist(series,bins=opts.get("bins",15),color=PALETTE[1],alpha=0.85,edgecolor="white")
    ax.set_title(title); ax.set_xlabel(c); ax.set_ylabel("Count")
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_scatter(df,q,title,out,opts):
    if len(q)<2: raise ValueError("scatter needs 2 questions")
    x,y=q[0],q[1]
    fig,ax=plt.subplots(figsize=_fs(opts,(6,5)))
    ax.scatter(pd.to_numeric(df[x],errors="coerce"),pd.to_numeric(df[y],errors="coerce"),color=PALETTE[0],alpha=0.6,s=40,edgecolors="white",linewidth=0.5)
    ax.set_title(title); ax.set_xlabel(x); ax.set_ylabel(y)
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_box_plot(df,q,title,out,opts):
    if len(q)<2: raise ValueError("box_plot needs 2 questions")
    cat,num=q[0],q[1]; n=opts.get("top_n",10)
    top_cats=df[cat].value_counts().head(n).index
    groups=[pd.to_numeric(df[df[cat]==c][num],errors="coerce").dropna() for c in top_cats]
    fig,ax=plt.subplots(figsize=_fs(opts,(8,5)))
    bp=ax.boxplot(groups,patch_artist=True,labels=top_cats)
    for i,patch in enumerate(bp["boxes"]): patch.set_facecolor(PALETTE[i%len(PALETTE)]); patch.set_alpha(0.75)
    ax.set_title(title); ax.set_ylabel(num); plt.xticks(rotation=30,ha="right")
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_heatmap(df,q,title,out,opts):
    if len(q)<2: raise ValueError("heatmap needs 2 questions")
    r,c=q[0],q[1]; n=opts.get("top_n",10)
    top_r=df[r].value_counts().head(n).index; top_c=df[c].value_counts().head(n).index
    pivot=pd.crosstab(df[r],df[c]).loc[lambda x:x.index.isin(top_r),lambda x:x.columns.isin(top_c)]
    fig,ax=plt.subplots(figsize=_fs(opts,(8,6)))
    im=ax.imshow(pivot.values,cmap="YlGn",aspect="auto")
    ax.set_xticks(range(len(pivot.columns))); ax.set_yticks(range(len(pivot.index)))
    ax.set_xticklabels(pivot.columns,rotation=30,ha="right",fontsize=9); ax.set_yticklabels(pivot.index,fontsize=9)
    for i in range(len(pivot.index)):
        for j in range(len(pivot.columns)): ax.text(j,i,pivot.values[i,j],ha="center",va="center",fontsize=8)
    plt.colorbar(im,ax=ax,shrink=0.7); ax.set_title(title)
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_treemap(df,q,title,out,opts):
    import squarify
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",15))
    fig,ax=plt.subplots(figsize=_fs(opts,(8,5)))
    squarify.plot(sizes=counts.values,label=counts.index,color=PALETTE[:len(counts)],alpha=0.8,ax=ax)
    ax.set_title(title); ax.axis("off"); plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_waterfall(df,q,title,out,opts):
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",12)).sort_index()
    running=counts.cumsum(); bottoms=[0]+list(running.values[:-1])
    fig,ax=plt.subplots(figsize=_fs(opts,(8,4)))
    for i,(label,val,bottom) in enumerate(zip(counts.index,counts.values,bottoms)):
        ax.bar(label,val,bottom=bottom,color=PALETTE[i%len(PALETTE)],alpha=0.85,edgecolor="white")
    ax.set_title(title); ax.set_ylabel("Cumulative count"); plt.xticks(rotation=30,ha="right")
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_funnel(df,q,title,out,opts):
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",10)).sort_values(ascending=False)
    fig,ax=plt.subplots(figsize=_fs(opts,(7,max(3,len(counts)*0.5))))
    max_val=counts.values[0]
    for i,(label,val) in enumerate(zip(counts.index,counts.values)):
        w=val/max_val; left=(1-w)/2
        ax.barh(i,w,left=left,color=PALETTE[i%len(PALETTE)],alpha=0.85,height=0.6)
        ax.text(0.5,i,f"{label}  ({val})",ha="center",va="center",fontsize=9,color="white",fontweight="bold")
    ax.set_xlim(0,1); ax.axis("off"); ax.set_title(title)
    plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

def chart_table(df,q,title,out,opts):
    c=q[0]; counts=_top(df[c].dropna(),opts.get("top_n",15)).reset_index()
    counts.columns=[c,"Count"]
    counts["Percent"]=(counts["Count"]/counts["Count"].sum()*100).round(1).astype(str)+"%"
    fig,ax=plt.subplots(figsize=_fs(opts,(6,max(2,len(counts)*0.35+1)))); ax.axis("off")
    tbl=ax.table(cellText=counts.values,colLabels=counts.columns,cellLoc="center",loc="center")
    tbl.auto_set_font_size(False); tbl.set_fontsize(10); tbl.scale(1,1.4)
    for (row,col),cell in tbl.get_celld().items():
        if row==0: cell.set_facecolor(PALETTE[0]); cell.set_text_props(color="white",fontweight="bold")
        elif row%2==0: cell.set_facecolor("#F5F5F5")
        cell.set_edgecolor("#DDDDDD")
    ax.set_title(title,pad=10); plt.tight_layout(); fig.savefig(out,dpi=150,bbox_inches="tight"); plt.close(fig)

CHART_DISPATCH = {
    "bar":chart_bar,"horizontal_bar":chart_horizontal_bar,"stacked_bar":chart_stacked_bar,
    "pie":chart_pie,"donut":chart_donut,"line":chart_line,"area":chart_area,
    "histogram":chart_histogram,"scatter":chart_scatter,"box_plot":chart_box_plot,
    "heatmap":chart_heatmap,"treemap":chart_treemap,"waterfall":chart_waterfall,
    "funnel":chart_funnel,"table":chart_table,
}
